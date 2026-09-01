// Minimal Gamepad API wrapper for XInput-style controllers (Xbox / most USB controllers).
// Browsers expose XInput devices through navigator.getGamepads() with the "standard" mapping:
// axes[0]/[1] = left stick, axes[2]/[3] = right stick, buttons[12..15] = d-pad,
// buttons[0] = A, buttons[9] = Start.
//
// Note: Chrome/Edge will not list a gamepad in navigator.getGamepads() until the user
// presses a button on it (moving the stick alone does not register the connection).
//
// Some software (e.g. keyboard macro utilities) registers a virtual "gamepad" that never
// sends real input, and some wireless dongles report a non-"standard" mapping even for a
// real Xbox-style pad. Callers can pass a preferredId (from settings) to pin a specific
// device; otherwise we prefer standard-mapped devices, falling back to whatever's first.
let prevButtonsById = new Map();

window.addEventListener('gamepadconnected', (e) => {
  console.log('[gamepad] connected:', e.gamepad.id, 'index', e.gamepad.index, 'mapping', e.gamepad.mapping);
});
window.addEventListener('gamepaddisconnected', (e) => {
  console.log('[gamepad] disconnected:', e.gamepad.id);
  prevButtonsById.delete(e.gamepad.id);
});

export function listConnectedPads() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  return Array.from(pads).filter((gp) => gp && gp.connected);
}

// Virtual/companion devices (e.g. the Keychron Link, vendor 3434) enumerate as gamepads
// but never send real input — never auto-pick them over a real controller.
function isVirtualPad(gp) { return /keychron|vendor:\s*3434/i.test(gp.id); }

function selectPad(connected, preferredId) {
  if (preferredId) {
    const pinned = connected.find((gp) => gp.id === preferredId);
    if (pinned) return pinned;
  }
  // Prefer a standard-mapped real controller (works the same wired or wireless), then any
  // non-virtual pad, then anything at all as a last resort.
  return connected.find((gp) => gp.mapping === 'standard' && !isVirtualPad(gp))
    || connected.find((gp) => !isVirtualPad(gp))
    || connected.find((gp) => gp.mapping === 'standard')
    || connected[0]
    || null;
}

export function pollGamepad(preferredId = null) {
  const gp = selectPad(listConnectedPads(), preferredId);
  if (!gp) return null;

  const prevButtons = prevButtonsById.get(gp.id) || [];
  const buttons = gp.buttons.map((b) => b.pressed || b.value > 0.5);
  const justPressed = buttons.map((p, i) => p && !prevButtons[i]);
  prevButtonsById.set(gp.id, buttons);

  const deadzone = 0.22;
  let mx = gp.axes[0] || 0;
  let my = gp.axes[1] || 0;
  if (Math.hypot(mx, my) < deadzone) { mx = 0; my = 0; }
  if (buttons[12]) my -= 1; // d-pad up
  if (buttons[13]) my += 1; // d-pad down
  if (buttons[14]) mx -= 1; // d-pad left
  if (buttons[15]) mx += 1; // d-pad right
  mx = Math.max(-1, Math.min(1, mx));
  my = Math.max(-1, Math.min(1, my));

  let ax = gp.axes[2] || 0;
  let ay = gp.axes[3] || 0;
  if (Math.hypot(ax, ay) < deadzone) { ax = 0; ay = 0; }

  return {
    id: gp.id, mapping: gp.mapping, move: { x: mx, y: my }, aim: { x: ax, y: ay },
    buttons, justPressed, rawAxes: gp.axes.slice(),
  };
}

export function isGamepadConnected() {
  return listConnectedPads().length > 0;
}
