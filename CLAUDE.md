# murali

## Project Overview

**Languages:** javascript
**Frameworks:** none detected
**Primary:** javascript

## Code Style

- Linter: ESLint
- Formatter: Prettier
- Type checking: tsc --noEmit

## Testing

- Test framework: vitest or jest
- Run tests: `npm test`
- Coverage: `npm run test -- --coverage`

## Security

- No hardcoded secrets, use environment variables
- Validate all user inputs
- Parameterized queries for database access

<!-- IRONBARK:START - Auto-generated, do not edit -->
## Ironbark

This project uses the Ironbark learning loop with auto-sync to the community skill repo (`chatgptnotes/ironbark`).

- **Auto-harvest**: After 15+ tool calls, Ironbark nudges you to run `/ironbark`
- **Manual harvest**: Run `/ironbark` at any time to extract reusable patterns
- **Background sync**: Every 30 min, `sync-cli.js` pulls new community skills and pushes local ones
- **Opt-out**: `IRONBARK_SYNC_DISABLED=1`

### Available Harvested Skills (100)

Loaded from `~/.claude/skills/harvested/`. Reference any skill below by name or path when the task matches.

| Skill | Description | Path |
|-------|-------------|------|
| `Adamrit Final Bill Lock — pre-deploy SHA256 check` | Freezes src/pages/FinalBill.tsx in the Adamrit hospital-management app. A `prebuild` script (chained ahead of `vite build`, which Vercel inv | `/Users/murali/.claude/skills/harvested/adamrit-check-test/SKILL.md` |
| `Annotated Sales-Pitch Coaching PDF` | When you write a 30/60/90-second elevator pitch for someone (founder rehearsing for an enterprise meeting, BNI member doing a 60-second intr | `/Users/murali/.claude/skills/harvested/annotated-pitch-coaching-pdf/SKILL.md` |
| `Async AI Advisory on Real-Time Hot Path` | Pattern for void-launching AI analysis from time-critical control loops (alarm engines, tag processors) with dedup guards, cooldown periods, | `/Users/murali/.claude/skills/harvested/async-ai-advisory-hot-path/SKILL.md` |
| `Auto-Tenant Fetch Wrapper` | Modify the frontend API fetch wrapper to auto-append tenant_id from session storage so all existing API calls get tenant scoping without per | `/Users/murali/.claude/skills/harvested/auto-tenant-fetch-wrapper/SKILL.md` |
| `BNI CRM — Bugs & Gotchas Harvested During Build` | Non-obvious issues encountered while building a Supabase-backed multi-page CRM (BNI 121). Covers nginx root-path confusion, PostgREST schema | `/Users/murali/.claude/skills/harvested/bni-crm-build-pitfalls/SKILL.md` |
| `Browser-Console curl|bash Deploy Bootstrap` | When SSH to a VPS is blocked from the agent's network and the only available shell is a browser-based console (Hostinger hPanel, DigitalOcea | `/Users/murali/.claude/skills/harvested/browser-console-curl-bash-deploy/SKILL.md` |
| `bulk-file-to-db-importer` | Node.js script to bulk-import local files (HTML, PDF, etc.) into a Supabase table under a specific user, with a permanent exclusion list and | `/Users/murali/.claude/skills/harvested/bulk-file-to-db-importer/SKILL.md` |
| `Chatbot Reply/Ignore Intent Gate` | System prompt pattern that adds a first-pass REPLY vs IGNORE decision layer to any chatbot, preventing it from replying to casual acknowledg | `/Users/murali/.claude/skills/harvested/chatbot-reply-intent-gate/SKILL.md` |
| `Claude CLI: ANTHROPIC_API_KEY env silently overrides Max-plan OAuth` | When the Claude CLI runs inside a container or service and ANTHROPIC_API_KEY is in the environment, it ignores the OAuth credentials in ~/.c | `/Users/murali/.claude/skills/harvested/claude-cli-oauth-vs-apikey-precedence/SKILL.md` |
| `Claude Code -> DeepSeek Backend (Anthropic-Compatible Redirect)` | Point Claude Code at DeepSeek's Anthropic-compatible endpoint via ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN + ANTHROPIC_MODEL env vars. Cove | `/Users/murali/.claude/skills/harvested/claude-code-deepseek-backend/SKILL.md` |
| `Claude Code Permanent SSH Access to VPS` | Set up passwordless SSH key access so Claude Code can run remote commands on a VPS directly via Bash tool, without prompting for a password  | `/Users/murali/.claude/skills/harvested/claude-vps-ssh-access/SKILL.md` |
| `cloud-to-vps-http-bridge` | Lightweight Node.js HTTP bridge that lets a serverless cloud platform (Vercel, Railway, etc.) trigger actions on a self-hosted VPS service — | `/Users/murali/.claude/skills/harvested/cloud-to-vps-http-bridge/SKILL.md` |
| `Credential Survivorship Audit` | When a credentials-based failure recurs after a previous fix, the credential was only partially removed. Grep all config locations first, fi | `/Users/murali/.claude/skills/harvested/credential-survivorship-audit/SKILL.md` |
| `Cron-Poll Continuous Deploy via git ls-remote SHA Check` | When GitHub Actions SSH-deploy and inbound webhooks are both unavailable (SSH port blocked from runners, VPS behind NAT/firewall, no webhook | `/Users/murali/.claude/skills/harvested/cron-poll-continuous-deploy/SKILL.md` |
| `Custom Slash Command — Encode Multi-Step Protocols` | Create custom Claude Code slash commands in ~/.claude/commands/ that invoke repeatable multi-step workflows with $ARGUMENTS substitution — s | `/Users/murali/.claude/skills/harvested/custom-slash-command-protocol/SKILL.md` |
| `document-version-history` | Save every version of a document before overwriting — Supabase versions table, PATCH intercept, restore endpoint, and UI history panel | `/Users/murali/.claude/skills/harvested/document-version-history/SKILL.md` |
| `Dual LLM Provider Budget Defense` | Production budget-burn protection when running two LLM providers — per-user app-layer daily cap (not nginx per-IP), burst detection, provide | `/Users/murali/.claude/skills/harvested/dual-llm-provider-budget-defense/SKILL.md` |
| `Dual-Publish Reusable Setup Guide as Local Skill + Standalone Public Repo` | When the user asks to save procedural how-to content "for next time," publish it in two places at once - as a harvested SKILL.md (auto-loads | `/Users/murali/.claude/skills/harvested/dual-publish-skill-and-repo/SKILL.md` |
| `Email-Allowlist Dual-Gate Dashboard` | Restrict access to a privileged dashboard (CEO/CFO/Director/Admin view) to a hard-coded allowlist of email addresses. Defense in depth at th | `/Users/murali/.claude/skills/harvested/email-allowlist-dual-gate-dashboard/SKILL.md` |
| `EventEmitter → Socket.IO → Zustand Reactive Pipeline` | Full backend-to-frontend reactive chain using Node EventEmitter as source, Socket.IO rooms for transport, and Zustand store for state — with | `/Users/murali/.claude/skills/harvested/eventemitter-socketio-zustand-pipeline/SKILL.md` |
| `excel-matrix-to-react-lookup` | Convert a multi-dimensional Excel combination matrix into a JS lookup table and React UI card, dynamically driven by algorithm/API output sc | `/Users/murali/.claude/skills/harvested/excel-matrix-to-react-lookup/SKILL.md` |
| `Exhaustive Error Hunting — Never Stop at the First Fix` | When debugging a broken feature, NEVER assume the first error found is the only one. Systematically trace the entire data path and fix ALL b | `/Users/murali/.claude/skills/harvested/exhaustive-error-hunting/SKILL.md` |
| `Express Rate Limit Hardening` | Security fixes for express-rate-limit — never trust X-Forwarded-For in keyGenerator, handle IPv6, use validate options | `/Users/murali/.claude/skills/harvested/express-rate-limit-hardening/SKILL.md` |
| `Express Tenant Middleware Chain` | requireAuth → requireTenantAccess → route pattern with profile caching and role-based tenant resolution for multi-tenant Express apps | `/Users/murali/.claude/skills/harvested/express-tenant-middleware-chain/SKILL.md` |
| `gh api Bulk Operations Without Zsh Glob Expansion Bugs` | When scripting `gh api` to POST/PATCH the same payload to many GitHub repos (bulk webhooks, branch-protection rules, repo settings), the `-f | `/Users/murali/.claude/skills/harvested/gh-api-bulk-json-stdin/SKILL.md` |
| `Global CLAUDE.md — Auto-Loaded Coding Standards` | Create ~/.claude/CLAUDE.md to inject coding rules, forbidden patterns, and workflow protocols into every Claude Code session automatically — | `/Users/murali/.claude/skills/harvested/global-claude-md-standards/SKILL.md` |
| `Google OAuth COOP Popup Fix on Vercel` | Two-stage fix for Google OAuth popup blocked by Cross-Origin-Opener-Policy (COOP) on Vercel — first add permissive headers, then switch to c | `/Users/murali/.claude/skills/harvested/google-oauth-coop-vercel-fix/SKILL.md` |
| `Hand-Fillable PDF Blanks via Dotted-Underline CSS Spans` | When generating a PDF that will be printed and signed by hand (legal forms, KYC, lease agreements, school admission, customs declarations, v | `/Users/murali/.claude/skills/harvested/dotted-blank-fillable-pdf/SKILL.md` |
| `HTML Print Window with Per-Section Page Breaks` | Generate downloadable PDFs from a SPA by opening a styled HTML document in a new window, applying CSS `@media print` rules with `page-break- | `/Users/murali/.claude/skills/harvested/html-print-window-section-pagebreaks/SKILL.md` |
| `HTML-to-PPTX Programmatic Generation` | Generate professional PowerPoint presentations (.pptx) programmatically using python-pptx — build slides with shapes, colored cards, code bl | `/Users/murali/.claude/skills/harvested/html-to-pptx-python/SKILL.md` |
| `HTTP API Failure Isolation via Probe Matrix` | When an HTTP API call fails with an ambiguous error and you don't know whether the cause is the URL, the auth header, the request body, the  | `/Users/murali/.claude/skills/harvested/http-api-probe-matrix-isolation/SKILL.md` |
| `Idempotent ~/.zshrc / ~/.bashrc Block Append with Marker-Based Dedupe` | Append a multi-line block of exports/aliases/path edits to a user's shell rc file via an installer that is safe to re-run. Uses a marker com | `/Users/murali/.claude/skills/harvested/idempotent-shellrc-marker-dedupe/SKILL.md` |
| `Industrial Rollback Policy Pattern` | PLC batch write rollback with persistence, exponential retry, timeout, and real-time operator notifications via Socket.IO | `/Users/murali/.claude/skills/harvested/rollback-policy-pattern/SKILL.md` |
| `karpathy-guidelines` | Behavioral guidelines to reduce common LLM coding mistakes. Use when writing, reviewing, or refactoring code to avoid overcomplication, make | `/Users/murali/.claude/skills/harvested/karpathy-guidelines/SKILL.md` |
| `LLM Chat Context — History Depth and Temperature Config` | Configure conversation history depth (maxHistoryMessages) and temperature on a deployed LLM chatbot to prevent context amnesia and hallucina | `/Users/murali/.claude/skills/harvested/llm-chat-context-config/SKILL.md` |
| `LLM Model Routing` | Regex-based classifier to route simple user queries to cheap models (Haiku) and complex ones to expensive models (Sonnet), with conservative | `/Users/murali/.claude/skills/harvested/llm-model-routing/SKILL.md` |
| `LLM Provider baseUrl + API-Type URL Construction Bug` | When a custom LLM provider's baseUrl already includes a version suffix and the gateway appends /v1/messages, you get /{version}/v1/messages  | `/Users/murali/.claude/skills/harvested/llm-provider-url-construction-bug/SKILL.md` |
| `LLM Vision Confidence Escalation Cascade` | Two-stage vision pipeline — cheap primary model on every request, expensive model only on low-confidence results. Cuts cost ~80% vs single-m | `/Users/murali/.claude/skills/harvested/llm-vision-confidence-escalation-cascade/SKILL.md` |
| `Mac Disk Space Cleanup Playbook` | Systematic Mac disk space recovery — ordered by impact. Covers Chrome AI models, screen recordings, node_modules, Zoom recordings, app cache | `/Users/murali/.claude/skills/harvested/mac-disk-space-cleanup-playbook/SKILL.md` |
| `macOS Chrome Disk-Write Quota Crash Fix` | Diagnose and fix Chrome being killed by macOS for exceeding disk write limits — root cause is the 4 GB OptGuideOnDeviceModel AI model rewrit | `/Users/murali/.claude/skills/harvested/macos-chrome-disk-write-crash-fix/SKILL.md` |
| `MCA Director-Appointment Form Generator (DIR-2 / DIR-8 / MBP-1 / Info Template)` | A repeatable HTML→PDF generator for filling India's Ministry of Corporate Affairs director-appointment forms. The user keeps verified KYC va | `/Users/murali/.claude/skills/harvested/mca-director-form-generator/SKILL.md` |
| `Multi-Channel Alert Gateway` | BaseChannel abstraction + severity-based routing + parallel delivery via Promise.allSettled + retry + delivery tracking table | `/Users/murali/.claude/skills/harvested/multi-channel-alert-gateway/SKILL.md` |
| `Multi-Tenant Audit Checklist` | Systematic methodology for finding multi-tenant data leaks — check every GET endpoint, AI context, external clients, and trace ownership cha | `/Users/murali/.claude/skills/harvested/multi-tenant-audit-checklist/SKILL.md` |
| `No Mock Data in Production SCADA/Multi-Modal Apps` | Eliminate hardcoded mock arrays in CRUD pages and backend demo-data fallbacks — every feature must use real API calls with database persiste | `/Users/murali/.claude/skills/harvested/no-mock-data-in-production/SKILL.md` |
| `No Unwired Placeholders — Wire Everything on First Pass` | Every button, link, and interactive element must have a working onClick/navigation handler from the moment it's created. Never leave placeho | `/Users/murali/.claude/skills/harvested/no-unwired-placeholders/SKILL.md` |
| `oauth-headless-ssh-tunnel` | Complete an OAuth2 browser flow on a headless Linux server by forwarding the redirect URI port via SSH tunnel — no browser, VNC, or public p | `/Users/murali/.claude/skills/harvested/oauth-headless-ssh-tunnel/SKILL.md` |
| `OpenClaw WhatsApp Echo Loop & LLM Quota Fix` | Stop infinite WhatsApp message loops caused by selfChatMode and quota-exceeded LLM keys in OpenClaw. Also covers zai/custom provider 404 bug | `/Users/murali/.claude/skills/harvested/openclaw-whatsapp-loop-fix/SKILL.md` |
| `openwrt-busybox-shell-scripting` | Practical shell scripting on OpenWrt/BusyBox edge devices (Teltonika TRB/RUT, GL.iNet, etc.). Covers what doesn't work (bash, jq, arrays) an | `/Users/murali/.claude/skills/harvested/openwrt-busybox-shell-scripting/SKILL.md` |
| `pdf-spec-to-compliance-matrix` | Methodological pattern for turning a vendor specification PDF into a citation-anchored markdown compliance matrix. Extract PDF text with pdf | `/Users/murali/.claude/skills/harvested/pdf-spec-to-compliance-matrix/SKILL.md` |
| `Pentest-Driven Architecture Review` | Validate architectural decisions against the most recent pentest report + a handful of targeted live probes — faster and more precise than r | `/Users/murali/.claude/skills/harvested/pentest-driven-architecture-review/SKILL.md` |
| `pgvector Multi-Tenant Retrieval` | Multi-tenant pgvector RAG pattern — enforce project/tenant isolation at the query layer with WHERE project_id = ANY($ids), never trust RLS w | `/Users/murali/.claude/skills/harvested/pgvector-multitenant-retrieval/SKILL.md` |
| `Placeholder Audit and Resolution Pattern` | Systematic scan for empty placeholders, disabled buttons, stub endpoints, dead files, and unmounted routes — then resolve each by either imp | `/Users/murali/.claude/skills/harvested/placeholder-audit-pattern/SKILL.md` |
| `Plan File Versioned Evolution` | How to evolve a committed roadmap document incrementally via targeted Edit calls, version-bump footers, and commit messages that explain WHY | `/Users/murali/.claude/skills/harvested/plan-file-versioned-evolution/SKILL.md` |
| `PLC Live Integration Test Infrastructure` | Software PLC simulators + test harness for validating SCADA protocol adapters with real TCP traffic instead of mocks | `/Users/murali/.claude/skills/harvested/plc-live-test-infrastructure/SKILL.md` |
| `PM2 Cluster Mode Breaks In-Memory SCADA State` | PM2 cluster mode causes polling engine, tag engine, and Socket.IO room subscriptions to split across workers — use single instance for SCADA | `/Users/murali/.claude/skills/harvested/pm2-cluster-scada-pitfall/SKILL.md` |
| `Postgres FK Constraint Repair via Dynamic DO Block` | When a foreign-key constraint was added out-of-band (via the database dashboard, ad-hoc psql session, or an old script) and you don't know w | `/Users/murali/.claude/skills/harvested/postgres-fk-repair-dynamic-block/SKILL.md` |
| `PostgREST Schema Cache Reload After DDL` | Supabase / PostgREST returns "Could not find the 'X' column of 'Y' in the schema cache" even after `alter table add column` succeeds, becaus | `/Users/murali/.claude/skills/harvested/postgrest-schema-cache-reload/SKILL.md` |
| `Prisma SQL Injection Defense` | Safe patterns for dynamic SQL with Prisma $queryRawUnsafe — allowlist maps instead of string interpolation for identifiers | `/Users/murali/.claude/skills/harvested/prisma-sql-injection-defense/SKILL.md` |
| `Process Log Tracing — Find Logs When Not Under Named Systemd Service` | When a process logs to systemd journal but isn't registered as a named service, journalctl -u <name> returns nothing. Trace via fd/1 socket  | `/Users/murali/.claude/skills/harvested/process-log-tracing/SKILL.md` |
| `Project Gate Pattern` | Enforce project selection before accessing project-scoped pages — gate at layout level, not per-page | `/Users/murali/.claude/skills/harvested/project-gate-pattern/SKILL.md` |
| `proposal-field-standardization` |  | `/Users/murali/.claude/skills/harvested/proposal-field-standardization/SKILL.md` |
| `pull-based-remote-agent-architecture` | Remote shell execution on NAT-bound IoT/edge devices via cloud-polling agent. Device pulls commands from HTTPS API instead of accepting inbo | `/Users/murali/.claude/skills/harvested/pull-based-remote-agent-architecture/SKILL.md` |
| `quick-login-direct-auth` | Quick-login buttons that directly authenticate via Supabase auth API on click — not just pre-filling form fields. Fixes the pattern where cl | `/Users/murali/.claude/skills/harvested/quick-login-direct-auth/SKILL.md` |
| `React Async-Callback State Snapshot Before Reset` | Bug pattern — when a handler resets React state synchronously AND fires an async mutation whose `onSuccess` later needs that same state, the | `/Users/murali/.claude/skills/harvested/react-async-state-snapshot/SKILL.md` |
| `React Error Object Rendering Guard` | Prevent React error #31 when API proxy/intermediary returns {code, message} objects instead of {error: string} — always coerce error state t | `/Users/murali/.claude/skills/harvested/react-error-object-guard/SKILL.md` |
| `ReactFlow Node Data Persistence` | Fix silent data loss in ReactFlow editors where elementsToNodes/nodesToElements serialization drops custom fields like tag bindings, animati | `/Users/murali/.claude/skills/harvested/reactflow-data-persistence/SKILL.md` |
| `Responsive shadcn Dialog with Pinned Header/Footer and Scrollable Body` | Make a shadcn (Radix UI) `<DialogContent>` responsive on small viewports — body content scrolls inside the dialog while the header (title) a | `/Users/murali/.claude/skills/harvested/shadcn-dialog-responsive-scrollable/SKILL.md` |
| `rsync Deploy Protection in a Directory Shared with Human-Managed Files` | Your deploy script rsyncs a repo subtree into a directory that *also* contains files maintained outside the repo (a public landing page, ad- | `/Users/murali/.claude/skills/harvested/rsync-deploy-shared-dir-protection/SKILL.md` |
| `SCADA Real-Time ReactFlow — Complete Debugging Case Study` | 12-issue chain that prevented live PLC tag values from updating ReactFlow HMI elements. Documents every failure point and the final working  | `/Users/murali/.claude/skills/harvested/scada-realtime-reactflow-debugging/SKILL.md` |
| `SCADA Screen Persistence Pattern` | HMI screens stored in Zustand must persist to database via API — loadScreens on mount, save on create/update/delete | `/Users/murali/.claude/skills/harvested/screen-persistence-pattern/SKILL.md` |
| `SCADA Tag Autocomplete Component` | Inline searchable dropdown for selecting PLC/SCADA tags scoped to the active project — fetches once, filters client-side | `/Users/murali/.claude/skills/harvested/scada-tag-autocomplete/SKILL.md` |
| `Screenshot-to-Root-Cause Error Diagnosis` | Decode minified React/production errors from browser screenshots — decode error URLs, trace stack traces, identify the actual component and  | `/Users/murali/.claude/skills/harvested/screenshot-error-diagnosis/SKILL.md` |
| `Self-Updating Cron Script via Remote Fetch and Atomic Re-Exec` | A long-running cron script installed at `/usr/local/bin/foo.sh` is a frozen snapshot of the day it was installed — every logic change requir | `/Users/murali/.claude/skills/harvested/self-updating-cron-script/SKILL.md` |
| `shared-vps-coexistence` | Operational rules and procedures for safely adding a new product to a busy multi-tenant Linux VPS (Hostinger, DigitalOcean droplet, EC2, bar | `/Users/murali/.claude/skills/harvested/shared-vps-coexistence/SKILL.md` |
| `Sliding Window Dedup Guard` | Time-windowed event counting with three dedup layers (memory Map, database query, cooldown period) for rate-sensitive detectors that must av | `/Users/murali/.claude/skills/harvested/sliding-window-dedup-guard/SKILL.md` |
| `Socket.IO Room Subscription Chain` | Complete the subscribe chain — frontend store must emit subscribe event to server, server must join client to room, then room-scoped emit wo | `/Users/murali/.claude/skills/harvested/socketio-room-subscription-chain/SKILL.md` |
| `Soft-Delete via hidden Flag for Reversible Dedupe` | Instead of `delete from`, mark duplicate or stale records with `hidden=true` and have every list view filter `hidden=false` by default with  | `/Users/murali/.claude/skills/harvested/soft-delete-hidden-flag/SKILL.md` |
| `Split Auth Modal — Sign-In vs Sign-Up Mode` | Single AuthModal component with a `mode` prop that drives distinct UX flows — sign-in rejects new users, sign-up shows details form for new  | `/Users/murali/.claude/skills/harvested/split-auth-modal-signin-signup/SKILL.md` |
| `stateful-cli-as-http-service` | Wrap a stateful or interactive CLI (claude, gh copilot, REPL tools) as an HTTP service. Covers the subset of CLI-bridge problems the plain c | `/Users/murali/.claude/skills/harvested/stateful-cli-as-http-service/SKILL.md` |
| `Subscription vs Pay-As-You-Go API Key Billing Mismatch (Insufficient-Balance Despite Valid Plan)` | When a SaaS / LLM provider returns "insufficient balance" or 4xx-billing errors despite an active, paid subscription, the most common cause  | `/Users/murali/.claude/skills/harvested/subscription-vs-payg-api-key-billing-mismatch/SKILL.md` |
| `Supabase Owner-Only Storage + RLS for Sensitive Per-User PII` | When a Supabase app needs to store sensitive per-user files (KYC docs, ID cards, medical reports, financial records) such that only the file | `/Users/murali/.claude/skills/harvested/supabase-owner-only-storage-pii/SKILL.md` |
| `Supabase Polling Overload — Diagnosis and Fix` | When Supabase shows millions of DB requests from a React app, the cause is almost always cascading React Query refetchIntervals and unguarde | `/Users/murali/.claude/skills/harvested/supabase-polling-overload-fix/SKILL.md` |
| `Supabase SQL → Clipboard Workflow` | When `supabase db push` is blocked by historical unapplied migrations on a linked project, copy each new migration's SQL to the macOS clipbo | `/Users/murali/.claude/skills/harvested/supabase-sql-clipboard-workflow/SKILL.md` |
| `Supabase Tenant Filtering via Inner Joins` | Use !inner join + dot-notation filtering to scope Supabase queries through related tables for multi-tenant isolation | `/Users/murali/.claude/skills/harvested/supabase-tenant-filtering/SKILL.md` |
| `supabase-multi-tenant-rls-jwt-claims` | Full recipe for multi-tenant SaaS isolation on Supabase using Postgres Row Level Security and JWT custom claims. Covers the profiles ↔ auth. | `/Users/murali/.claude/skills/harvested/supabase-multi-tenant-rls-jwt-claims/SKILL.md` |
| `SVG Sanitization with DOMPurify` | Replace regex-based SVG sanitizers with DOMPurify SVG profile — regex is trivially bypassable | `/Users/murali/.claude/skills/harvested/svg-sanitization-dompurify/SKILL.md` |
| `svg-icons-html-pdf` |  | `/Users/murali/.claude/skills/harvested/svg-icons-html-pdf/SKILL.md` |
| `Timezone-Aware Hourly Cron Fanout` | Run an hourly cron that uses Intl.DateTimeFormat to check each user's local hour — only deliver to users whose timezone hour matches the tar | `/Users/murali/.claude/skills/harvested/timezone-aware-cron-fanout/SKILL.md` |
| `Token-Saving Toolkit Install` | One-stop install procedure for the 5 Claude Code tools that cut token / API spend the most — Graphify (codebase knowledge graph), Firecrawl  | `/Users/murali/.claude/skills/harvested/token-saving-toolkit-install/SKILL.md` |
| `Vercel Prebuilt Deploy Workaround` | When Vercel remote builds fail silently (empty error message), build locally with vercel build --prod then deploy with vercel deploy --prebu | `/Users/murali/.claude/skills/harvested/vercel-prebuilt-deploy/SKILL.md` |
| `vercel-frontend-vps-backend-split` | Topology pattern when the frontend is on Vercel (auto-deploy from GitHub) but the backend (API + DB + workers) lives on a separate self-host | `/Users/murali/.claude/skills/harvested/vercel-frontend-vps-backend-split/SKILL.md` |
| `Vite Environment URL Auto-Detection` | Frontend apps deployed to Vercel must auto-detect API/WebSocket URLs for production vs development — never default to localhost for both API | `/Users/murali/.claude/skills/harvested/vite-env-url-detection/SKILL.md` |
| `WhatsApp Instant Acknowledgment Before Slow Processing` | Send an immediate ack message to the user before kicking off a long-running operation (AI inference, email fetch, DB query). Prevents user t | `/Users/murali/.claude/skills/harvested/whatsapp-instant-ack/SKILL.md` |
| `WhatsApp Personalized Research Before Replying` | Before replying to any BNI member on WhatsApp, research their company, specialty, city, and prior conversation context. Never send generic r | `/Users/murali/.claude/skills/harvested/whatsapp-personalized-research/SKILL.md` |
| `WhatsApp Self-Chat Loop — Token Drain Diagnosis` | When LLM balance drains faster than expected on a WhatsApp bot, check for self-chat loop (bot replying to its own number) and oversized per- | `/Users/murali/.claude/skills/harvested/whatsapp-selfchat-token-drain/SKILL.md` |
| `Worker Read-Only DB Role Pattern` | Background workers (BullMQ, cron, etc.) should read operational data via a dedicated SELECT-only Postgres role with its own DATABASE_URL — n | `/Users/murali/.claude/skills/harvested/worker-readonly-db-role-pattern/SKILL.md` |
| `Z.AI (Zhipu GLM) Provider Config — OpenAI-Compatible Format` | Z.AI (bigmodel.cn / zhipuai.cn) uses OpenAI-compatible /chat/completions API. Setting api type to "anthropic-messages" appends /v1/messages  | `/Users/murali/.claude/skills/harvested/zai-openai-compatible-provider/SKILL.md` |
| `Z.AI GLM Coding Plan + Claude Code (Anthropic-Compatible Endpoint, Per-Slot Model Mapping)` | Configure Claude Code to use Z.AI's GLM Coding Plan (Lite / Pro / Max subscription) via the Anthropic-compatible endpoint at api.z.ai/api/an | `/Users/murali/.claude/skills/harvested/zai-coding-plan-claude-code/SKILL.md` |
| `Zero Mock, Zero Fallback — Honest Data or Honest Error` | Enforce strict no-mock, no-fallback policy across frontend and backend. API failure shows error, empty data shows blank — never fake data, n | `/Users/murali/.claude/skills/harvested/zero-mock-zero-fallback/SKILL.md` |
| `Zero-Hardcode Bottom-Up Integration Protocol` | 5-step mandatory build order for any data-display feature — Backend → Verify → Store → UI → Traceability. Prevents AI from hallucinating a " | `/Users/murali/.claude/skills/harvested/zero-hardcode-integration-protocol/SKILL.md` |

_Catalog auto-regenerated on every Claude Code session start. Do not edit between the IRONBARK markers, manual edits outside the block are preserved._

<!-- IRONBARK:END -->
