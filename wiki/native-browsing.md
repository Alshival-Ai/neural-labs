# Browsing with Alshival

On the native runtime, Alshival uses your selected Codex or Claude Code connection
to browse through Playwright. No additional API key is needed. AI image generation
is not included.

Ask it to research a public website, find information, follow links, test a
workspace app, fill out a form, capture a screenshot, or download a document.
Search uses public search pages and may encounter site restrictions or challenges.
Alshival can extract PDF text and show individual PDF pages.

Public-site interactions show an approval describing the website and action.
Only that action is approved. Team Chat keeps administrator-only approvals;
automation runs cannot approve interactive website actions themselves.

Screenshots and downloads appear as chat attachments. They remain private to the
conversation or visible to authorized members of the Team channel. Use the
attachment menu's **Download to Workspace** action to choose a shared folder and
filename. Downloading to your own device does not create a shared workspace copy.

Browser sessions do not reuse your personal browser sign-ins. A personal
conversation can retain browser state for up to 30 idle minutes. Team and job
browser sessions end with their run. Private infrastructure, provider credentials,
and other users' content are outside the browser's access boundary.

For static workspace sites, Alshival opens a confined preview of the selected
site directory. Registered workspace apps use the existing app registry and
reserved development ports. Preview addresses are internal to the managed
browser; they do not publish your site.

See [the browser architecture decision](adr/0041-native-browser-and-artifacts.md)
for limits, authorization, artifact APIs and operator configuration.
