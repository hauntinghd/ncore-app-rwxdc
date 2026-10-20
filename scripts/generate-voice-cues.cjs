#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const sampleRate = 44100;
const outputDir = path.resolve(__dirname, '..', 'public', 'sounds');

const cues = {
  'ncore-mute-on.wav': [[880, 0.00, 0.055], [659, 0.055, 0.115]],
  'ncore-mute-off.wav': [[659, 0.00, 0.055], [1047, 0.055, 0.115]],
  'ncore-deafen-on.wav': [[988, 0.00, 0.060], [587, 0.065, 0.125]],
  'ncore-deafen-off.wav': [[587, 0.00, 0.060], [1175, 0.065, 0.125]],
};

/*
  Looping call sounds. Each file is exactly one loop period so playback can
  set loop=true with no gap logic. Placeholders until custom (fal.ai) sounds
  replace them — same file names, drop-in.
*/
const loops = {
  // Caller hears this while the other side rings: two soft pulses, rest.
  'ncore-ringback.wav': {
    duration: 3.0,
    notes: [[440, 0.00, 0.40], [480, 0.00, 0.40], [440, 0.55, 0.40], [480, 0.55, 0.40]],
  },
  // Callee hears this: a rising three-note phrase, twice, then rest.
  'ncore-ringtone.wav': {
    duration: 2.4,
    notes: [
      [784, 0.00, 0.14], [988, 0.15, 0.14], [1175, 0.30, 0.22],
      [784, 0.70, 0.14], [988, 0.85, 0.14], [1175, 1.00, 0.22],
    ],
  },
};

function writeCue(name, notes, duration = 0.24) {
  const frames = Math.ceil(duration * sampleRate);
  const pcm = Buffer.alloc(frames * 2);
  for (let index = 0; index < frames; index += 1) {
    const time = index / sampleRate;
    let sample = 0;
    for (const [frequency, start, length] of notes) {
      const local = time - start;
      if (local < 0 || local > length) continue;
      const attack = Math.min(1, local / 0.008);
      const release = Math.min(1, Math.max(0, (length - local) / 0.045));
      const envelope = attack * release;
      sample += (Math.sin(Math.PI * 2 * frequency * local) + 0.22 * Math.sin(Math.PI * 2 * frequency * 2 * local)) * 0.19 * envelope;
    }
    pcm.writeInt16LE(Math.max(-1, Math.min(1, sample)) * 32767, index * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(path.join(outputDir, name), Buffer.concat([header, pcm]));
}

fs.mkdirSync(outputDir, { recursive: true });
for (const [name, notes] of Object.entries(cues)) writeCue(name, notes);
for (const [name, loop] of Object.entries(loops)) writeCue(name, loop.notes, loop.duration);
console.log(`[voice-cues] Generated ${Object.keys(cues).length + Object.keys(loops).length} NCore voice cues.`);
