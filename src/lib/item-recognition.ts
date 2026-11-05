import type { AudioMatch, ItemRecognition, ItemSizeEvidence, SoundCandidate, SoundHypothesis } from '../types';

export const MIN_SIZE_CONFIDENCE = 0.75;
const DEFAULT_AUDIO_THRESHOLD = 0.88;

function validDimension(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 20;
}

function trustedSize(evidence?: ItemSizeEvidence): evidence is ItemSizeEvidence {
  return !!evidence && validDimension(evidence.width) && validDimension(evidence.height)
    && (evidence.source === 'manual' || (evidence.source === 'detected'
      && Number.isFinite(evidence.confidence) && evidence.confidence! >= MIN_SIZE_CONFIDENCE && evidence.confidence! <= 1));
}

function compatibleSize(size: [number, number], evidence: ItemSizeEvidence): boolean {
  // Merchant cargo preserves the catalog orientation: width and height are ordered.
  return size[0] === evidence.width && size[1] === evidence.height;
}

function uniqueCandidates(candidates: SoundCandidate[]): SoundCandidate[] {
  return [...new Map(candidates.map(candidate => [candidate.id, candidate])).values()];
}

function plausibleHypotheses(match: AudioMatch): SoundHypothesis[] {
  const threshold = Number.isFinite(match.threshold) && match.threshold! >= 0 && match.threshold! <= 1
    ? match.threshold! : DEFAULT_AUDIO_THRESHOLD;
  // Unknown silence/low-similarity matches have no retained, accepted alternatives.
  const hypotheses = match.alternatives?.length ? match.alternatives : match.status === 'match' ? [{
    referenceId: match.referenceId ?? '', name: match.name, groupId: match.groupId, action: match.action,
    rarity: match.rarity, candidates: match.candidates, similarity: match.similarity,
  }] : [];
  const ranked = hypotheses.filter(item => Number.isFinite(item.similarity) && item.similarity >= threshold && item.similarity <= 1)
    .sort((a, b) => b.similarity - a.similarity);
  if (!ranked.length) return [];
  const families = new Map<string, SoundHypothesis>();
  for (const hypothesis of ranked) {
    if (ranked[0].similarity - hypothesis.similarity >= 0.025) continue;
    const key = hypothesis.groupId !== undefined ? `group:${hypothesis.groupId}` : JSON.stringify([hypothesis.name, hypothesis.rarity]);
    if (!families.has(key)) families.set(key, hypothesis);
  }
  return [...families.values()];
}

/**
 * Exact catalog intersection, not a probability estimator. A single survivor means
 * one item in the current catalog fits the measured cues; it is not game-wide proof.
 * The caller may pass previous ONLY for the same item in the same inventory view.
 */
export function resolveItemMatch(match: AudioMatch, evidence?: ItemSizeEvidence, previous?: AudioMatch): AudioMatch {
  const hypotheses = plausibleHypotheses(match);
  const catalog = hypotheses.filter(hypothesis => Number.isInteger(hypothesis.groupId) && hypothesis.groupId! >= 1 && hypothesis.candidates?.length);
  const allCandidates = uniqueCandidates(catalog.flatMap(hypothesis => hypothesis.candidates!));
  const recognition: ItemRecognition = {
    status: 'audio-only', candidatesBefore: allCandidates.length, candidatesAfter: allCandidates.length,
    observations: 1, reason: 'Для уточнения по размеру нужен подтверждённый размер предмета в ячейках.',
  };
  if (!catalog.length || !trustedSize(evidence)) {
    if (!catalog.length) recognition.reason = 'Нет надёжного совпадения с предметным каталогом; размер сам по себе не определяет предмет.';
    else if (evidence) recognition.reason = 'Размер сетки не подтверждён или его геометрия недостаточно надёжна; учитывается только звук.';
    return { ...match, ...(allCandidates.length ? { candidates: allCandidates } : {}), recognition };
  }

  recognition.observedSize = [evidence.width, evidence.height];
  recognition.sizeSource = evidence.source;
  let candidates = allCandidates.filter(candidate => compatibleSize(candidate.size, evidence));
  const unresolvedPersonal = hypotheses.some(hypothesis => !catalog.includes(hypothesis));
  const prior = previous?.recognition;
  if (prior && ['identified', 'ambiguous'].includes(prior.status) && prior.observedSize
    && compatibleSize(prior.observedSize, evidence) && previous?.candidates?.length) {
    const ids = new Set(previous.candidates.map(candidate => candidate.id));
    candidates = candidates.filter(candidate => ids.has(candidate.id));
    recognition.observations = Math.min(500, Math.max(1, prior.observations || 1) + 1);
  }
  recognition.candidatesAfter = candidates.length;
  if (!candidates.length) {
    recognition.status = 'conflict';
    recognition.reason = recognition.observations > 1
      ? 'Наблюдения одного предмета противоречат друг другу. Проверьте ячейку и повторите звук.'
      : 'Звук и размер не совпадают ни с одним предметом каталога. Проверьте границы груза и повторите запись.';
    return { ...match, status: 'unknown', name: 'Не определено', rarity: undefined, candidates: [], reason: recognition.reason, recognition };
  }

  const ids = new Set(candidates.map(candidate => candidate.id));
  const survivingGroups = catalog.filter(hypothesis => hypothesis.candidates!.some(candidate => ids.has(candidate.id)));
  const best = survivingGroups[0];
  const singleGroup = survivingGroups.length === 1 && !unresolvedPersonal;
  const unique = candidates.length === 1 && !unresolvedPersonal;
  recognition.status = unique ? 'identified' : 'ambiguous';
  recognition.reason = unique
    ? 'Один предмет в каталоге соответствует звуку и размеру.'
    : unresolvedPersonal
      ? 'Есть конкурирующая запись без подтверждённого размера; однозначное определение невозможно.'
      : 'Несколько предметов имеют подходящие звук и размер; нужны дополнительные признаки.';
  if (unique) recognition.item = candidates[0];
  return {
    ...match,
    status: singleGroup || unique ? 'match' : 'unknown',
    name: unique ? candidates[0].name : singleGroup ? best.name : 'Не определено',
    rarity: unique ? candidates[0].rarity : undefined,
    referenceId: singleGroup ? best.referenceId : undefined,
    groupId: singleGroup ? best.groupId : undefined,
    action: singleGroup ? best.action : undefined,
    similarity: best.similarity,
    candidates,
    reason: recognition.reason,
    recognition,
  };
}
