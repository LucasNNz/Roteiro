import type { SceneAudioPreset } from "../../app/types.ts";
import { audioClipEnvelope, clampAudioStart, effectiveAudioClipDuration, presetClips } from "../audio/scenes.ts";

export type DecodedAudioSource = {
  sampleRate: number;
  channelData: Float32Array[];
};

export type MixedSceneAudio = {
  sampleRate: number;
  numberOfChannels: 2;
  length: number;
  channelData: [Float32Array, Float32Array];
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const finiteSample = (value: number) => Number.isFinite(value) ? value : 0;

export type LinkedPeakLimiterState = { gain: number };

export function applyLinkedPeakLimiter(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  ceiling = .9,
  releaseSeconds = .12,
  state: LinkedPeakLimiterState = { gain: 1 },
) {
  const safeCeiling = clamp(ceiling, .1, .99);
  const release = 1 - Math.exp(-1 / Math.max(1, sampleRate * Math.max(.01, releaseSeconds)));
  let gain = Number.isFinite(state.gain) ? state.gain : 1;
  const length = Math.min(left.length, right.length);
  for (let frame = 0; frame < length; frame += 1) {
    // Alguns decodificadores podem devolver uma amostra inválida em arquivos
    // comprimidos danificados. NaN/Infinity não podem chegar ao AAC: embora não
    // sejam audíveis como números, o codec pode convertê-los em uma rajada alta.
    const leftSample = finiteSample(left[frame]);
    const rightSample = finiteSample(right[frame]);
    const peak = Math.max(Math.abs(leftSample), Math.abs(rightSample));
    const targetGain = peak > 1 ? safeCeiling / peak : 1;
    // Ataque imediato segura o pico; a volta gradual impede bombeamento brusco.
    gain = targetGain < gain ? targetGain : gain + (targetGain - gain) * release;
    left[frame] = clamp(finiteSample(leftSample * gain), -1, 1);
    right[frame] = clamp(finiteSample(rightSample * gain), -1, 1);
  }
  state.gain = gain;
}

function sampleChannel(source: DecodedAudioSource, channel: number, time: number) {
  const data = source.channelData[Math.min(channel, source.channelData.length - 1)];
  if (!data?.length || !Number.isFinite(time) || !Number.isFinite(source.sampleRate)) return 0;
  const position = Math.max(0, time * source.sampleRate);
  const left = Math.max(0, Math.min(data.length - 1, Math.floor(position)));
  const right = Math.min(data.length - 1, left + 1);
  const fraction = position - left;
  const leftSample = finiteSample(data[left]);
  const rightSample = finiteSample(data[right]);
  return finiteSample(leftSample + (rightSample - leftSample) * fraction);
}

function smoothstep(value: number) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function sampleLoopedChannel(source: DecodedAudioSource, channel: number, loopStart: number, loopDuration: number, elapsed: number) {
  const duration = Math.max(1 / source.sampleRate, loopDuration);
  const phase = ((elapsed % duration) + duration) % duration;
  const joinDuration = Math.min(.008, duration / 4);
  const endTime = loopStart + Math.max(0, duration - 1 / source.sampleRate);
  const raw = sampleChannel(source, channel, Math.min(endTime, loopStart + phase));
  if (joinDuration <= 1 / source.sampleRate) return raw;

  // Os dois lados da volta encontram o mesmo valor. Isso remove o degrau da
  // onda que causava o clique/risco a cada repeticao sem alterar o ritmo.
  const boundary = (sampleChannel(source, channel, loopStart) + sampleChannel(source, channel, endTime)) / 2;
  if (phase < joinDuration) {
    const blend = smoothstep(phase / joinDuration);
    return boundary + (raw - boundary) * blend;
  }
  if (phase > duration - joinDuration) {
    const blend = smoothstep((phase - (duration - joinDuration)) / joinDuration);
    return raw + (boundary - raw) * blend;
  }
  return raw;
}

function automaticCutEnvelope(elapsed: number, totalDuration: number, sampleRate: number) {
  if (sampleRate < 1_000 || totalDuration <= .01) return 1;
  const edge = Math.min(.005, totalDuration / 2);
  return Math.min(1, Math.max(0, elapsed / edge), Math.max(0, (totalDuration - elapsed) / edge));
}

export function mixSceneAudioRange(
  preset: SceneAudioPreset,
  duration: number,
  decodedBySrc: ReadonlyMap<string, DecodedAudioSource>,
  startFrame: number,
  numberOfFrames: number,
  sampleRate = 48_000,
  limiterState: LinkedPeakLimiterState = { gain: 1 },
): MixedSceneAudio {
  const totalLength = Math.max(1, Math.ceil(Math.max(0, duration) * sampleRate));
  const safeStartFrame = Math.max(0, Math.min(totalLength, Math.floor(startFrame)));
  const length = Math.max(0, Math.min(Math.floor(numberOfFrames), totalLength - safeStartFrame));
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  const masterVolume = clamp(preset.masterVolume, 0, 1);
  const rangeEndFrame = safeStartFrame + length;

  for (const clip of presetClips(preset)) {
    const source = decodedBySrc.get(clip.src);
    if (!source?.channelData.length || !source.channelData[0]?.length) continue;
    const sourceDuration = source.channelData[0].length / source.sampleRate;
    const trimStart = Math.max(0, Math.min(sourceDuration - .05, clip.trimStart ?? 0));
    const playableDuration = effectiveAudioClipDuration(clip, sourceDuration - trimStart);
    const effectiveStart = clampAudioStart(clip.start, duration);
    const audibleDuration = Math.max(.001, Math.min(playableDuration, duration - effectiveStart));
    const clipStartFrame = Math.max(0, Math.floor(effectiveStart * sampleRate));
    const boundedEnd = Number.isFinite(clip.end) ? Math.max(effectiveStart, Math.min(duration, clip.end!)) : duration;
    const clipEndFrame = Math.min(Math.ceil(boundedEnd * sampleRate), clip.loop ? totalLength : Math.ceil((effectiveStart + audibleDuration) * sampleRate));
    const overlapStart = Math.max(safeStartFrame, clipStartFrame);
    const overlapEnd = Math.min(rangeEndFrame, clipEndFrame);
    const gain = clamp(clip.volume, 0, 1) * masterVolume;
    if (gain <= 0 || overlapStart >= overlapEnd) continue;

    for (let globalFrame = overlapStart; globalFrame < overlapEnd; globalFrame += 1) {
      const elapsed = globalFrame / sampleRate - effectiveStart;
      if (elapsed < 0) continue;
      const totalDuration = clip.loop ? boundedEnd - effectiveStart : Math.min(audibleDuration, boundedEnd - effectiveStart);
      const envelope = audioClipEnvelope(clip, elapsed, totalDuration) * automaticCutEnvelope(elapsed, totalDuration, sampleRate);
      const timelineElapsed = clip.timelineOffset === undefined ? elapsed : Math.max(0, clip.timelineOffset - trimStart) + elapsed;
      const loopDuration = clip.timelineOffset === undefined ? playableDuration : Math.max(.001, sourceDuration - trimStart);
      const rightChannel = source.channelData.length > 1 ? 1 : 0;
      const localFrame = globalFrame - safeStartFrame;
      if (clip.loop) {
        left[localFrame] += sampleLoopedChannel(source, 0, trimStart, loopDuration, timelineElapsed) * gain * envelope;
        right[localFrame] += sampleLoopedChannel(source, rightChannel, trimStart, loopDuration, timelineElapsed) * gain * envelope;
      } else {
        const sourceTime = clip.timelineOffset === undefined ? trimStart + elapsed : Math.min(sourceDuration - .001, clip.timelineOffset + elapsed);
        left[localFrame] += sampleChannel(source, 0, sourceTime) * gain * envelope;
        right[localFrame] += sampleChannel(source, rightChannel, sourceTime) * gain * envelope;
      }
    }
  }

  applyLinkedPeakLimiter(left, right, sampleRate, .9, .12, limiterState);
  return { sampleRate, numberOfChannels: 2, length, channelData: [left, right] };
}

export function mixSceneAudio(
  preset: SceneAudioPreset,
  duration: number,
  decodedBySrc: ReadonlyMap<string, DecodedAudioSource>,
  sampleRate = 48_000,
): MixedSceneAudio {
  const length = Math.max(1, Math.ceil(Math.max(0, duration) * sampleRate));
  return mixSceneAudioRange(preset, duration, decodedBySrc, 0, length, sampleRate);
}

export function audioDataPlan(length: number, sampleRate = 48_000, frameSize = 1024) {
  const plan: Array<{ startFrame: number; numberOfFrames: number; timestamp: number }> = [];
  for (let startFrame = 0; startFrame < length; startFrame += frameSize) {
    plan.push({
      startFrame,
      numberOfFrames: Math.min(frameSize, length - startFrame),
      timestamp: Math.round(startFrame * 1_000_000 / sampleRate),
    });
  }
  return plan;
}
