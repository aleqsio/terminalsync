# TerminalSync Landing Page — Design Brief

## Product
TerminalSync — the easiest way to access your terminal from your phone. One command, one QR scan, full terminal on mobile. "Your terminal, everywhere."

## Copy

### Hero
- Headline: "Your terminal, everywhere"
- Sub: "One command. One QR scan. Full terminal access from your phone."
- Body: "Monitor builds. Approve Claude Code prompts. Debug with your team. All from your phone."
- Primary CTA: "Get Started"
- Secondary CTA: "View on GitHub"

### How It Works — "Terminal to phone in three steps"
1. **Run one command** — `npx terminalsync` in any terminal. No config, no account.
2. **Scan the QR code** — Point your phone camera. Tap the link. You're connected.
3. **Full terminal on mobile** — Type commands, review output, approve actions. Same terminal, different screen.

### Use Cases — "Built for real workflows"
1. **AI coding from anywhere** — Claude Code waiting for approval? Review the diff and approve from your couch.
2. **Monitor long-running processes** — Builds, migrations, deploys. Check progress from anywhere.
3. **Collaborative debugging** — Share your terminal session. Multiple people, same view. No screen sharing needed.
4. **Always-on terminal access** — Add to shell startup. Every terminal, always accessible.

### Mobile Showcase — "A real terminal on your phone"
- Touch-optimized xterm.js with quick keys (Tab, Esc, Ctrl+C, arrows)
- Smart keyboard handling — terminal adjusts when keyboard appears
- Session management — switch between multiple terminals
- Works over local network by default, tunnel for internet

### Trust Signals — "Local-first. Private by design."
- Local network first, no cloud relay
- Token-based auth, secure by default
- Optional Cloudflare tunnel for remote access
- Open source

### Install — "Start in 10 seconds"
```bash
npx terminalsync
```
That's it. Auto-starts server, generates token, shows QR.

### Final CTA
- "Your terminal awaits"
- "No signup. No credit card. Install and connect."
- CTA: "Get Started"

---

## Design Spec

### Colors
- Primary bg: #0a0a0f (near black)
- Secondary bg: #111118
- Card bg: #16161e
- Text primary: #e0e0e0
- Text muted: #888
- Text dim: #555
- Accent (pink/red): #e94560
- Accent glow: rgba(233, 69, 96, 0.4)
- Success: #4caf50
- Info blue: #4a9eff
- Warning: #e9a945
- Border: #222, #333

### Typography
- Hero H1: 72px/4.5rem, weight 700, tracking tight
- Section H2: 48px/3rem, weight 700
- H3: 24px, weight 600
- Body: 18px, weight 400, #888
- Code: Menlo/monospace, 14px
- Use Inter or system font for headings/body

### Layout
- Max width: 1200px container, centered
- Generous vertical padding: py-32 to py-40 between sections
- Dot grid background pattern (subtle, 20% opacity)

### Cards (glassmorphism)
- bg: rgba(22, 22, 30, 0.6)
- backdrop-filter: blur(12px)
- border: 1px solid #222
- border-radius: 16px
- Hover: border #444, translateY(-2px), subtle glow

### Terminal Mockup (Hero)
- macOS window chrome (traffic lights, title bar)
- bg: #111118, border: 1px solid #222, rounded-xl
- Animated typing effect showing:
  ```
  $ npx terminalsync
  ✓ Server started on port 8089
  ✓ Token generated

  📱 Scan to connect:
  [QR CODE]

  ✓ Connected: iPhone 15 Pro
  ```
- Prompt `$` in accent color, checkmarks in green

### Phone Mockup
- iPhone-style frame with rounded corners, notch
- Shows terminal app with green "Connected" indicator
- Quick keys bar at bottom
- Terminal content with colored prompts

### Buttons
- Primary: bg accent, text dark, px-8 py-4, rounded-lg, glow shadow
- Secondary: transparent, border #333, text light
- Hover: scale 1.02, glow intensifies

### Animations
- Scroll-triggered fade-in + slide-up
- Terminal typing effect in hero
- Cursor blink
- Staggered card entrances
- Subtle gradient shifts on accent text

### Responsive
- Mobile: single column, H1 40px, H2 32px
- Tablet: 2 columns
- Desktop: full spec
