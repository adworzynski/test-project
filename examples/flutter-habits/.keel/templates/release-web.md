---
id: {{id}}
type: release
status: draft
title: {{title}}
kind: web
version: "{{version}}"
build: "{{build}}"
links: {}
owner: {{owner}}
created: {{date}}
updated: {{date}}
---

# {{id}}: {{title}}

Tick every box (`- [x]`). `keel done {{id}}` refuses while any box is open, any story is unfinished
or any criterion lacks evidence. Keel never deploys: the last step is yours.

## Version
- [ ] Version {{version}} set in {{version_file}}
- [ ] Release notes written (`keel release notes`)

## Build and hosting
- [ ] Production build passes
- [ ] Environment variables and secrets configured in the host (not in the repo)
- [ ] Domain, HTTPS and redirects verified

## Pages
{{screenshots}}

## Privacy
{{privacy}}

## Quality
- [ ] All stories done and every acceptance criterion has a passing test (`keel verify`)
- [ ] Accessibility check (WCAG 2.2 AA) on the main flows
- [ ] Error monitoring configured

## Deploy (human)
- [ ] I deployed to production myself and smoke-tested it
