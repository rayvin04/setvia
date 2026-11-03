# Visual asset provenance

## Setvia-authored assets

- The fifteen cartoon demonstration covers in public/covers are original, code-authored Setvia UI assets. They can be regenerated with node scripts/create-demo-covers.mjs. They are static illustrations, not Muse Image output.
- The cat mascot and participant avatars are original SVG components in client/Mascot.tsx.
- The homepage chat in public/story-media is the user-supplied, approved fictional chat GIF. Its existing final-frame PNG is used for reduced motion; its embedded metadata records that origin. The GIF and its four fictional participants are preserved.
- The Sunday plan beside the chat is rendered by client/InteractivePlanPreview.tsx. The former plan PNG is no longer shipped.
- The new repository cover is AI-generated with an existing Setvia cover as a visual reference. The optimized JPEG is docs/setvia-cover-2026-11-03.jpg; the generated PNG source is docs/assets/setvia-github-cover-2026-11-03.source.png. The art-direction record is docs/assets/setvia-github-cover-2026-11-03.art-direction.md. This public art-direction record describes the generation method without reproducing a tool prompt.
- The UI uses a plain-text hackathon credit. No Meta AI logo or symbol is included, and no live image-generation capability is implied.

## Third-party assets

- public/github-mark.svg comes from Primer Octicons. Its upstream MIT license is retained in public/github-mark.LICENSE.
- Lexend is supplied by @fontsource-variable/lexend under OFL-1.1. Lucide interface icons use the package's ISC license. See the [third-party notices](third-party-notices.md) for the direct dependency inventory and its audit limits.

The proprietary notice applies to Setvia-authored materials only. It does not replace or override third-party licenses. AI-generated image rights and protection may depend on the applicable jurisdiction; this documentation does not claim guaranteed exclusivity.
