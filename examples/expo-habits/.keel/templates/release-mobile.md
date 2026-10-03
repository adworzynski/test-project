---
id: {{id}}
type: release
status: draft
title: {{title}}
kind: mobile
version: "{{version}}"
build: "{{build}}"
links: {}
owner: {{owner}}
created: {{date}}
updated: {{date}}
---

# {{id}}: {{title}}

Tick every box (`- [x]`). `keel done {{id}}` refuses while any box is open, any story is unfinished
or any criterion lacks evidence. Keel never submits: the last step is yours.

## Version
- [ ] Version {{version}} and build {{build}} set in {{version_file}}
- [ ] Release notes written (`keel release notes`)

## Signing
- [ ] iOS: distribution certificate and App Store provisioning profile valid
- [ ] Android: upload keystore available and Play App Signing enabled
- [ ] No secrets, keystores or .p8 keys committed (Keel never stores them in .keel/)

## Store metadata
- [ ] App name and subtitle (iOS subtitle ≤ 30 characters), short description (Play ≤ 80 characters)
- [ ] Full description
- [ ] Keywords (iOS ≤ 100 characters)
- [ ] Category, age rating questionnaire, content rights
- [ ] Support URL, marketing URL and privacy policy URL

## Screenshots
{{screenshots}}

## Privacy
{{privacy}}

## Review notes
- [ ] Demo account or review instructions entered in App Store Connect and Play Console (not stored here)
- [ ] Explain any permission prompts and background modes

## Quality
- [ ] All stories done and every acceptance criterion has a passing test (`keel verify`)
- [ ] Tested on a physical device for each platform
- [ ] Crash reporting configured for the release build

## Submit (human)
- [ ] I uploaded the build to TestFlight / Play internal testing and smoke-tested it
- [ ] I submitted the app for review myself
