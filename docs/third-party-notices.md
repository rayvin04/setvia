# Third-party notices

Setvia-authored code and artwork are covered by the repository's all-rights-reserved notice. Third-party packages and assets remain under their own terms.

## Direct package inventory

The following are direct runtime and development dependencies in package.json. Resolved versions are recorded in package-lock.json; this table records the license identifiers declared by the inspected package manifests.

| Package                       | Scope         | Declared license                                                    |
| ----------------------------- | ------------- | ------------------------------------------------------------------- |
| `@fontsource-variable/lexend` | Runtime font  | [SIL Open Font License 1.1](https://spdx.org/licenses/OFL-1.1.html) |
| `clsx`                        | Runtime       | [MIT](https://spdx.org/licenses/MIT.html)                           |
| `express`                     | Runtime       | [MIT](https://spdx.org/licenses/MIT.html)                           |
| `lucide-react`                | Runtime icons | [ISC](https://spdx.org/licenses/ISC.html)                           |
| `motion`                      | Runtime       | [MIT](https://spdx.org/licenses/MIT.html)                           |
| `react`                       | Runtime       | [MIT](https://spdx.org/licenses/MIT.html)                           |
| `react-dom`                   | Runtime       | [MIT](https://spdx.org/licenses/MIT.html)                           |
| `react-router-dom`            | Runtime       | [MIT](https://spdx.org/licenses/MIT.html)                           |
| `tailwind-merge`              | Runtime       | [MIT](https://spdx.org/licenses/MIT.html)                           |
| `zod`                         | Runtime       | [MIT](https://spdx.org/licenses/MIT.html)                           |
| `@tailwindcss/vite`           | Development   | [MIT](https://spdx.org/licenses/MIT.html)                           |
| `@types/express`              | Development   | [MIT](https://spdx.org/licenses/MIT.html)                           |
| `@types/node`                 | Development   | [MIT](https://spdx.org/licenses/MIT.html)                           |
| `@types/react`                | Development   | [MIT](https://spdx.org/licenses/MIT.html)                           |
| `@types/react-dom`            | Development   | [MIT](https://spdx.org/licenses/MIT.html)                           |
| `@vitejs/plugin-react`        | Development   | [MIT](https://spdx.org/licenses/MIT.html)                           |
| `prettier`                    | Development   | [MIT](https://spdx.org/licenses/MIT.html)                           |
| `tailwindcss`                 | Development   | [MIT](https://spdx.org/licenses/MIT.html)                           |
| `tsx`                         | Development   | [MIT](https://spdx.org/licenses/MIT.html)                           |
| `typescript`                  | Development   | [Apache License 2.0](https://spdx.org/licenses/Apache-2.0.html)     |
| `vite`                        | Development   | [MIT](https://spdx.org/licenses/MIT.html)                           |

## Shipped asset

- public/github-mark.svg is the GitHub mark from Primer's Octicons repository. The upstream MIT text is retained in [public/github-mark.LICENSE](../public/github-mark.LICENSE).

Setvia's mascot and demo covers are authored as Setvia UI assets. The new repository cover was AI-generated with the existing Setvia cover as a reference; see the [asset provenance record](assets/setvia-github-cover-2026-11-03.art-direction.md). No Meta AI logo is included.

## Audit limits

A local manifest scan found declared license metadata for 135 of the 225 package-lock entries. The remaining 90 entries were not verified in that pass; the set includes platform-specific optional packages that were not installed, but this inventory does not certify every transitive dependency. License fields are package declarations, not an independent legal review.

Before redistributing built bundles or making a broader compliance claim, inspect the full lockfile dependency tree and the licenses and required notices for every shipped component. This file is a scoped inventory, not a representation that the full dependency tree has been cleared.
