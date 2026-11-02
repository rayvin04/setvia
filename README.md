# Setvia

Make plans that survive the group chat.

Phase 1 local UI prototype. All planning content in the browser remains mocked. A server-only Meta Model API foundation and opt-in local integration script now live under server/; the website UI is not connected to it yet. There is no live room collaboration or real export generation.

## Local development

Requires Node.js 22.12+ or 24 LTS.

```sh
npm install
npm run dev
```

Open http://127.0.0.1:5173. Run `npm run build` for the TypeScript and production build check.

## Routes

- `/`: landing page
- `/start`: room idea form preview
- `/join`: nickname and room link form preview
- `/demos`: fictional scenario entry point

The deployed application is planned to use Meta models only. This prototype sends no data to model APIs. Lexend is provided by @fontsource-variable/lexend (OFL-1.1); icons use lucide-react (ISC). Respect reduced-motion preferences.

## Meta Model API foundation

The website remains disconnected from the backend modules. For local setup, offline tests, and the gated live integration command, see docs/meta-api.md. The live command can incur usage charges.
