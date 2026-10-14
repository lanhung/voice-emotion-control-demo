# Project Description

Aura is a local voice emotion visualization demo. It captures microphone audio, uses SenseVoice for transcription and emotion recognition, and visualizes emotion and volume changes through a liquid orb or an 8 × 64 light matrix.

The frontend uses React, TypeScript, and Vite. The backend uses Node.js and Fastify, with a separate Python/PyTorch service for model inference. Deployment is supported through Docker Compose.

## Development Constraints

- Use TypeScript (`.ts` and `.tsx`) for frontend, Node.js backend, and tooling code. Do not add handwritten JavaScript files; generated JavaScript build output is allowed.
- Follow the existing project architecture and engineering conventions. Use cohesive modules, clear interfaces, explicit types, and consistent error handling.
- Implement features as maintainable application code rather than standalone scripts. Reuse shared logic and keep UI, business logic, and infrastructure responsibilities separate.
