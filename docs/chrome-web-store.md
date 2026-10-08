# Chrome Web Store readiness

The extension is Manifest V3 and separates API calls into its service worker. Current permissions are `storage`, `tabs`, `clipboardWrite` and `alarms`; required host access covers Facebook and localhost:3000; optional HTTPS access is granted only for the exact app origin selected during pairing. Alarms check due jobs during explicitly started automatic runs. Explain each use in the listing and request only what the shipped build uses.

The privacy disclosure should state that the extension stores a Groupflow device token locally, sends it to the configured Groupflow application API, opens selected Facebook Group pages, fills captions and attaches selected campaign images. The default assisted mode requires a user Post click; an explicit opt-in switch enables automatic clicks after preparation verification. There is no fixed group-count cap. Errors, approval and unknown results stop the run; uncertain attempts are locked to avoid duplicates. It does not collect Facebook credentials, cookies or browser sessions.

Build with `npm run extension:build`, then package the contents of `extension/dist` as a ZIP. Pairing requests permission for the selected application hostname, including Vercel and custom domains. This repository does not submit the extension to the Web Store.

