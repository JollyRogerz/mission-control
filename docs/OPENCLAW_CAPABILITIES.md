# OpenClaw Capabilities Guide
## What Your AI Assistant Can Do for Horizon Protocol
**Version:** 1.2 | **Updated:** 2026-02-01

---

## Quick Reference

| Category | Can Do Autonomously | Needs Your Approval |
|----------|---------------------|---------------------|
| **Code** | Write, test, commit to `openclaw/*` branches | Merge PRs, push to main/staging/develop |
| **Research** | Web search, analyze docs, compare tech | Publish findings publicly |
| **Grants** | Find grants, draft applications | Submit applications |
| **Reports** | Generate daily/weekly summaries | Send to external parties |
| **Git** | Create branches, draft PRs | Merge anything |

---

## 1. Development & Coding

### What to Ask

```
"Implement the proximity ranking algorithm for FeedService"
"Write unit tests for the XP calculation module"
"Refactor the mission creation flow to use the new escrow pattern"
"Add TypeScript types for the guild membership API"
"Review this PR for security issues: [link]"
"Fix the bug where missions don't expire correctly"
"Add documentation for the PaymentRouter contract"
"Set up the PostGIS spatial queries for location-based feed"
```

### What OpenClaw Will Do

1. Read the existing codebase in `/workspace/horizon`
2. Create a new branch: `openclaw/feature-name`
3. Write the code, tests, and documentation
4. Run tests locally (if possible)
5. Commit with format: `🦞 openclaw: feat(scope): description`
6. Push to the `openclaw/*` branch
7. Create a **draft PR** to `develop`
8. Notify you via Telegram with the PR link

### Limitations

- ❌ Cannot merge PRs (you must review and merge)
- ❌ Cannot push to `main`, `staging`, or `develop` directly
- ❌ Cannot modify smart contracts without your explicit approval
- ❌ Cannot access files outside the sandbox workspace

---

## 2. Research & Analysis

### What to Ask

```
"Compare PostGIS vs H3 for our geospatial needs"
"Research the latest Base L2 gas optimization techniques"
"What are the best practices for USDC escrow patterns?"
"Analyze competitor protocols: Superfluid, Coordinape, Gitcoin"
"Find security audit reports for similar mission/escrow contracts"
"What's the current state of account abstraction on Base?"
"Research Privy vs Dynamic for wallet integration"
"Summarize the latest EIP proposals relevant to our use case"
```

### What OpenClaw Will Do

1. Search the web for relevant information
2. Read documentation, whitepapers, and technical posts
3. Compile findings into a structured report
4. Save to `/workspace/docs/research/` or `/workspace/output/`
5. Include a **Source Map** with citations (anti-hallucination rule)
6. Send you a summary via Telegram

### Output Format

Every research report includes:
```markdown
## Source Map
| Claim | Source | Verified |
|-------|--------|----------|
| PostGIS supports 3D | [Official docs](url) | ✅ |
| H3 uses hexagons | [Uber engineering](url) | ✅ |
```

---

## 3. Grant Hunting & Applications

### What to Ask

```
"Find grants that fit Horizon Protocol"
"What's the deadline for Base Builder Grants Round 4?"
"Draft an application for the Circle Arc Builders Fund"
"Update our Thrive Protocol application with the latest metrics"
"What grants are available for DAO tooling projects?"
"Analyze if we're eligible for OP Retro Funding"
```

### Daily Grant Schedule (Automatic)

| Time (Lisbon) | Activity |
|---------------|----------|
| 09:00 | Search for new grants |
| 12:00 | Analyze any new findings |
| 18:00 | Summary to Telegram |

### Target Grants (Pre-configured)

| Program | Amount | Priority |
|---------|--------|----------|
| Base Builder Grants R4 | 1-5 ETH | HIGH |
| Thrive Protocol | Variable | HIGH |
| Circle Arc Builders Fund | $250k-$500k | HIGH |
| Solana Foundation | $25k-$100k+ | MEDIUM |
| OP Retro Funding | Variable | MEDIUM |

### What OpenClaw Will Do

1. Search grant databases and announcement channels
2. Evaluate fit against Horizon's profile
3. Draft the application with all required sections
4. Save to `/workspace/grants/`
5. **You must review and submit** (OpenClaw cannot submit)

---

## 4. Documentation

### What to Ask

```
"Document the MissionEscrow contract's public API"
"Write a README for the mobile app setup"
"Create API documentation for the Feed endpoints"
"Update the architecture diagram with the new services"
"Write a guide for new contributors"
"Document the mission lifecycle flow"
```

### What OpenClaw Will Do

1. Read the relevant code/contracts
2. Generate comprehensive documentation
3. Include code examples and diagrams (Mermaid)
4. Save to `/workspace/docs/` or update existing files
5. Create a PR if it's a repo change

---

## 5. Code Review

### What to Ask

```
"Review PR #42 for security issues"
"Check this contract for reentrancy vulnerabilities"
"Review the mobile app's state management approach"
"Audit the payment flow for edge cases"
"Check if this migration is safe"
```

### What OpenClaw Will Do

1. Read the code changes
2. Analyze for:
   - Security vulnerabilities
   - Logic errors
   - Performance issues
   - Best practice violations
   - Missing tests
3. Provide detailed feedback
4. Suggest specific fixes

---

## 6. Testing

### What to Ask

```
"Write tests for the XP calculation service"
"Add integration tests for the mission creation flow"
"Create test fixtures for the guild membership"
"Run the contract test suite and report failures"
"Write fuzz tests for the escrow edge cases"
```

### What OpenClaw Will Do

1. Analyze the code to understand behavior
2. Write comprehensive test cases
3. Include edge cases and error scenarios
4. Run tests if possible in the container
5. Report results with any failures explained

---

## 7. Status & Reporting

### What to Ask

```
"What's the status of the project?"
"Show me today's completed missions"
"How much have we spent this week?"
"What's in the grant pipeline?"
"Give me a weekly development summary"
"What PRs are pending review?"
```

### Automatic Reports

| Report | Schedule | Content |
|--------|----------|---------|
| Daily Summary | 09:00 Lisbon | Missions, XP, costs, deadlines |
| Weekly Report | Sunday 18:00 | Metrics, commits, recommendations |

---

## 8. Commands Reference

### Control Commands (via Telegram)

```
PAUSE ALL          → Stop all operations
PAUSE iTake        → Stop specific DAO
RESUME ALL         → Resume all operations
RESUME iTake       → Resume specific DAO
EMERGENCY STOP     → Full killswitch (manual restart needed)
STATUS             → Current state summary
AUDIT              → Recent audit log entries
```

### Approval Commands (for high-value actions)

When OpenClaw asks for approval, respond with:

```
APPROVE TX | amount=75 | to=0xabc... | reason=refund | nonce=1042
APPROVE CONFIG | change=rate_limit | reason=testing | nonce=1043
APPROVE MISSION | id=mission#1234 | reason=urgent | nonce=1044
```

---

## 9. Mission Work (XP & Rewards)

OpenClaw can work as a mission performer on Horizon itself:

### Mission Categories

| Type | Example | Reward | XP |
|------|---------|--------|-----|
| Research | PostGIS comparison | 10-25 USDC | 50-100 |
| Coding | Implement feature | 25-100 USDC | 100-300 |
| Testing | Write test suite | 15-50 USDC | 75-150 |
| Documentation | API docs | 10-30 USDC | 50-100 |
| Grant Writing | Application draft | 20-50 USDC | 100-200 |
| Code Review | Security review | 10-25 USDC | 50-100 |

### What to Ask

```
"Accept mission #1234 for feed ranking implementation"
"What missions are available that match your capabilities?"
"Submit proof for the completed research mission"
"Decompose mission #1234 into sub-tasks"
```

---

## 10. What OpenClaw CANNOT Do

### Hard Limits (Even If You Ask)

| Action | Reason |
|--------|--------|
| Transfer > 500 USDC in one transaction | Safety limit |
| Push to main/staging/develop | Protected branches |
| Merge any PR | Human review required |
| Modify smart contracts directly | Security critical |
| Access your other files (~/Documents, etc.) | Sandboxed |
| Share API keys or credentials | Security policy |
| Disable its own safety limits | Policy immutable |
| Submit grant applications | Human must submit |
| Publish to social media without approval | Public communications |

### Requires Your Approval First

| Action | Threshold |
|--------|-----------|
| Create missions | > 25 USDC |
| Treasury operations | > 50 USDC |
| Configuration changes | Any |
| Grant submissions | All |
| Social media posts | All |
| Ban/suspend DAOs | All |

---

## 11. Example Conversation Flows

### Development Task

```
You: "Implement the feed proximity ranking using PostGIS"

OpenClaw: "I'll implement proximity ranking for the feed. Let me:
1. Read the current FeedService code
2. Design the PostGIS query approach
3. Create branch: openclaw/feed-proximity-ranking
4. Implement the changes
5. Write tests
6. Create a draft PR

Starting now..."

[Later]

OpenClaw: "✅ PR ready: https://github.com/.../pull/47
- 3 commits
- Added PostGIS ST_Distance queries
- 12 tests passing
- Ready for your review"
```

### Research Task

```
You: "Research the best approach for on-chain reputation"

OpenClaw: "I'll research on-chain reputation systems. Analyzing:
- EAS (Ethereum Attestation Service)
- Lens Protocol reputation
- Gitcoin Passport
- Custom attestation patterns

I'll compile a comparison report..."

[Later]

OpenClaw: "📄 Report saved: /workspace/output/reputation-research.md

Summary:
- EAS recommended for flexibility
- Gitcoin Passport for sybil resistance
- Custom hybrid approach suggested

Source map included with 12 verified citations."
```

### Grant Hunt

```
You: "Any new grants this week?"

OpenClaw: "Grant Update [2026-02-01]:
• Found: 2 new opportunities
• Base Ecosystem Fund: ★★★★★ fit, deadline Feb 15
• Filecoin Grants: ★★☆☆☆ fit, not recommended
• Draft ready: Circle Arc v2 in /workspace/grants/
• Action needed: Review Base Builder by Feb 10"
```

---

## 12. Tips for Best Results

### Be Specific

```
❌ "Fix the bugs"
✅ "Fix the bug where missions created after midnight UTC don't appear in the feed"
```

### Provide Context

```
❌ "Update the contract"
✅ "Update MissionEscrow.sol to add a 24-hour grace period before expiration"
```

### Reference Existing Code

```
✅ "Follow the pattern in GuildDAO.sol for the new membership function"
✅ "Use the same validation approach as CreateMissionDto"
```

### Ask for Plans First (Complex Tasks)

```
✅ "Before implementing, outline your approach for the dispute resolution flow"
✅ "What files would you need to modify for this feature?"
```

---

## 13. Current Limitations (Phase 1)

Since we're in Phase 1 (Development Assistant), some features are not yet active:

| Feature | Status | Available When |
|---------|--------|----------------|
| Development work | ✅ Active | Now |
| Research | ✅ Active | Now |
| Grant hunting | ✅ Active | Now |
| Mission performer | ⏳ Pending | After mainnet |
| DAO operations | ⏳ Pending | After iTake pilot |
| Multi-agent swarm | ⏳ Pending | Phase 4 |

---

## Quick Start Prompts

Copy-paste these to get started:

```
"What's the current status of the Horizon codebase?"

"Find any new grants for decentralized coordination platforms"

"Review the mission escrow contract for security issues"

"Write tests for the XP calculation in packages/service/src/xp/"

"Compare Privy vs Dynamic for our wallet needs - create a research doc"

"What's blocking the feed service implementation?"

"Create documentation for the mobile app's mission flow"
```

---

*Last Updated: 2026-02-01*
*For: OpenClaw + Horizon Protocol Integration v1.2*
