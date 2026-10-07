# Local writing studio

Run `pnpm admin` from the theme checkout. On Windows, this opens the studio in the default browser at `http://127.0.0.1:4380/admin/`. `pnpm admin:serve` starts it without opening a browser. Set `ADMIN_PORT` to choose another port.

Requires the existing project dependencies and a **separate local content directory**, configured with `CONTENT_DIR` in `.env.local`. It uses the same content-source resolution as the theme. It does not edit the materialized `src/content` directory or add a server to the public static deployment.

## Writing

- Manage posts and moments, search content, edit metadata and read Markdown previews.
- Drafts with a body and valid title (posts only) save automatically after 1.8 seconds of idle input. Existing published content requires explicit saving. All edits also keep a browser recovery copy while unsaved.
- New files receive date-based names; their names become read-only after the first save, preserving links. Save filenames before starting to type if you want a custom slug.
- Images accept file selection, drag-and-drop and clipboard paste. The maximum input is 20 MB per image and 40 million decoded pixels. Still images are rotated, resized to fit 2000 × 2000 and encoded as WebP; animated images keep their animation. Repeated identical uploads reuse the same URL.
- A media picker inserts uploaded images into posts, covers or a moment's image array. Moment image descriptions remain editable.
- `Ctrl/Cmd + S` saves. `Ctrl/Cmd + Enter` saves content as ready for publication and opens the review. Markdown export is available for offline copies and resolving edit conflicts.
- Markdown previews do not execute HTML or MDX. Math, MDX and theme-specific directives require the production build for exact rendering.

## Publishing

The release screen shows the changed files and outstanding local commits. It includes posts and moments, supported raster images under `public/images`, the registered configuration domains under `config`, `content/spec/about.md`, custom footer HTML and `deployment.json`. Workflow files, environment files, arbitrary TypeScript and credentials are excluded. Changes still require a matching review and a passing build.

The review must match the exact file hashes and Git HEAD. Publishing requires `main`, an empty staging area, a distinct theme remote, and no commits on `origin/main` that are missing locally. It fetches but never pulls, merges or force-pushes. Outgoing commits containing other paths are refused.

The publish job runs local content preparation, Astro checks, icon and moment-image generation, production build, Pagefind and build verification. It then commits only reviewed paths and pushes to the content remote. During checks and publication, writes are blocked. Existing EdgeOne deployment hooks handle deployment; a successful push does not prove the hosted deployment completed. A failed push leaves the local commit intact for retry.

## Site settings

The Settings screen edits site and homepage text, profile, announcements, About Markdown, footer HTML, navigation, independent page switches and all registered configuration domains. Forms derive their fields and validation from the existing TypeScript configuration types. Existing defaults appear in the editor, but saving only writes changed values into the YAML override; theme defaults and YAML comments remain intact. Advanced YAML editing is available for detailed configuration and repairing syntax errors. Form and raw saves use separate actions.

The Sidebar screen controls its global switch, position and single/dual layout. All nine widget types can be enabled independently, ordered, assigned to top/sticky and primary/secondary slots, and filtered by page. Category/tag/series thresholds and calendar week start are editable. Module visibility still respects its existing underlying feature settings and available content.

All changes save to the private content source with optimistic revisions, atomic writes and local backups. Settings do not autosave; `Ctrl/Cmd + S` saves, and leaving a changed form asks whether to save or discard it. Publish from the release screen to update the website.

## Deployment controls

The private content repository can contain `deployment.json`:

```json
{ "autoDeploy": true, "locked": false, "reason": "" }
```

- `autoDeploy: false` permits local editing and content pushes, but pauses the production Hook and ordinary production preparation/builds.
- `locked: true` additionally blocks ordinary studio publishing. Local checks still work.
- “Save and sync deployment controls” publishes only the policy file. It works while locked so a lock can be synchronized or released. Other outstanding files or mixed outgoing commits are not silently bundled.
- The publishing service checks the refreshed remote lock as well; sync an unlock before publishing other content.

Missing policy means enabled and unlocked. Invalid policy fails closed. Production builds read the policy from the resolved content source, including freshly fetched Git content. Local studio checks intentionally use local preparation so previews remain available while paused.

For remote enforcement, the content repository deployment workflow must check this file before calling its Hook, and include the file in its push path filter. The supplied blog workflow uses checkout plus a validated policy gate. Synchronizing an enabled, unlocked policy triggers a new build. These controls preserve the currently published website and do not cancel Hook requests or deployments already in progress. Production enforcement requires the theme's normal `pnpm build` entry point; an external service that bypasses that entry point needs its own policy integration.

Configuration interactions were independently implemented with reference to [Decap file collections](https://decapcms.org/docs/collection-file/), [Keystatic singletons](https://keystatic.com/docs/singletons) and [TinaCMS schemas](https://tina.io/docs/schema/). No third-party CMS code or runtime was copied or added.

## Recovery and local access

Before overwriting or deleting a file, the studio stores its previous contents under ignored `.admin-state/<content-directory-id>/backups/`. The history screen shows the latest 100 versions and can restore them; restoring also backs up the current version. Images are not deleted when content is removed. Backups stay local and should be included in the user's computer backup policy.

Writes use revision checks and atomic replacement, so concurrent tabs cannot silently overwrite newer content. The server binds only to `127.0.0.1`, checks Host and Origin, and requires an HttpOnly SameSite session cookie plus a CSRF token. Symbolic links and path traversal are refused. Git uses the existing system SSH/credential configuration and disables interactive login. No Git credential is sent to the browser.

Closing the terminal stops the studio. Running the studio does not start Astro dev; use normal content sync and dev commands for an exact site preview. Do not run another check/build against the same checkout while a studio job is running.

## Verification

`pnpm admin:test` runs isolated filesystem, HTTP and local Git-transport tests. Tests create temporary content and bare repositories; they do not push to the user's real Git remote. Validate the actual theme with its normal `check`, `build` and `verify` commands.
