import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

// Reuse the public sample bundled with the locally downloaded SenseVoice model.
// No user recording is used, and no binary fixture is checked into the project.
const audio = execFileSync('docker', ['compose', 'exec', '-T', 'sensevoice', 'python', '-c', `
import io, math, sys, wave
import soundfile as sf
from scipy.signal import resample_poly
audio, rate = sf.read('/models/example/zh.mp3')
if audio.ndim > 1: audio = audio.mean(axis=1)
factor = math.gcd(rate, 16000)
audio = resample_poly(audio, 16000 // factor, rate // factor)[:40000]
buffer = io.BytesIO()
with wave.open(buffer, 'wb') as output:
    output.setnchannels(1)
    output.setsampwidth(2)
    output.setframerate(16000)
    output.writeframes((audio.clip(-1, 1) * 32767).astype('<i2').tobytes())
sys.stdout.buffer.write(buffer.getvalue())
`], { maxBuffer: 1024 * 1024 });
mkdirSync('.artifacts', { recursive: true });
writeFileSync('.artifacts/speech.wav', audio);
console.log('Prepared .artifacts/speech.wav from the local SenseVoice example.');
