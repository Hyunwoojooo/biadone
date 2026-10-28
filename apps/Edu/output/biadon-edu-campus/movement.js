/*
 * Campus movement uses original map coordinates; x/y is the character's feet.
 * The owner draws the character in onMove(state), including state.facing/moving.
 *
 * Callbacks: onMove(state), onNear(portal|null, state), onEnter(roomId, state),
 * onMode(mode, state). Modes: idle, walking, route, room, paused.
 * portal.radius is the Enter/near distance; automatic entry uses its inner circle.
 * goTo(id) returns false for an invalid/unreachable room; it never teleports.
 * pause(reason) pauses; pause(false) resumes except inside a room.
 * To close a room: close its dialog first, then leaveRoom(id). This places the feet
 * at portal.exit, resumes movement, blocks accidental re-entry until the character
 * leaves that portal's near circle, and focuses element without scrolling.
 * All returned/callback states are frozen copies. No rendering or dependencies.
 */
(function (global) {
  'use strict';

  const EPSILON = 1e-7;
  const FOOT_RADIUS = 5;
  const MAX_STEP = 2;
  const directionKeys = {
    arrowup: 'up', keyw: 'up', w: 'up', up: 'up',
    arrowdown: 'down', keys: 'down', s: 'down', down: 'down',
    arrowleft: 'left', keya: 'left', a: 'left', left: 'left',
    arrowright: 'right', keyd: 'right', d: 'right', right: 'right'
  };
  const footSamples = Array.from({length: 16}, (_, index) => {
    const angle = index * Math.PI / 8;
    return {x: Math.cos(angle) * FOOT_RADIUS, y: Math.sin(angle) * FOOT_RADIUS};
  });
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const point = value => ({x: Number(Array.isArray(value) ? value[0] : value?.x), y: Number(Array.isArray(value) ? value[1] : value?.y)});
  const finitePoint = value => Number.isFinite(value.x) && Number.isFinite(value.y);

  function insidePolygon(position, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[j], b = polygon[i];
      const dx = b.x - a.x, dy = b.y - a.y;
      const cross = (position.x - a.x) * dy - (position.y - a.y) * dx;
      // A union's shared edges are walkable, including points on the boundary.
      if (Math.abs(cross) <= EPSILON && position.x >= Math.min(a.x, b.x) - EPSILON && position.x <= Math.max(a.x, b.x) + EPSILON && position.y >= Math.min(a.y, b.y) - EPSILON && position.y <= Math.max(a.y, b.y) + EPSILON) return true;
      if ((a.y > position.y) !== (b.y > position.y) && position.x < (b.x - a.x) * (position.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }

  function create(options) {
    const element = options?.element;
    if (!element || typeof element.addEventListener !== 'function') throw new TypeError('CampusMovement.create requires a map element.');
    const doc = element.ownerDocument || global.document;
    const win = doc.defaultView || global;
    const polygons = (options.walkable || []).map(polygon => polygon.map(point));
    if (!polygons.length || polygons.some(polygon => polygon.length < 3 || polygon.some(vertex => !finitePoint(vertex)))) throw new TypeError('walkable must contain polygons with finite coordinates.');
    const start = point(options.start);
    if (!finitePoint(start)) throw new TypeError('start must have finite x/y coordinates.');
    const speed = Number.isFinite(options.speed) && options.speed > 0 ? options.speed : 140;
    const nodes = new Map();
    for (const source of options.nodes || []) {
      const position = point(source);
      if (!source || source.id == null || !finitePoint(position)) throw new TypeError('Each graph node requires an id and finite x/y.');
      if (nodes.has(source.id)) throw new TypeError('Graph node ids must be unique.');
      nodes.set(source.id, {id: source.id, ...position, links: new Set(source.links || [])});
    }
    // Walking corridors are bidirectional, even if only one endpoint lists a link.
    nodes.forEach(node => node.links.forEach(id => { if (nodes.has(id)) nodes.get(id).links.add(node.id); }));
    const portals = new Map();
    for (const source of options.portals || []) {
      const position = point(source), exit = point(source.exit || source);
      if (source.id == null || !finitePoint(position) || !finitePoint(exit)) throw new TypeError('Each portal requires an id, finite x/y, and exit x/y.');
      if (portals.has(source.id)) throw new TypeError('Portal ids must be unique.');
      const radius = Number.isFinite(source.radius) && source.radius > 0 ? source.radius : 30;
      portals.set(source.id, {id: source.id, ...position, exit, node: source.node, radius, autoRadius: Math.min(12, Math.max(4, radius * .35))});
    }
    const callbacks = options;
    const keys = new Map();
    const edgeCache = new Map();
    let x = start.x, y = start.y, facing = 'down', moving = false;
    let mode = 'idle', pauseReason = null, roomId = null, nearId = null;
    let destinationId = null, route = [], blockedAutoId = null, lastError = null;
    let raf = 0, lastTime = null, destroyed = false, lastMoveSignature = '';

    function inUnion(position) { return polygons.some(polygon => insidePolygon(position, polygon)); }
    function walkable(position) {
      if (!inUnion(position)) return false;
      return footSamples.every(offset => inUnion({x: position.x + offset.x, y: position.y + offset.y}));
    }
    if (!walkable(start)) throw new RangeError('The start feet position and 5-unit radius must be inside the walkable union.');
    function lineWalkable(from, to) {
      const steps = Math.max(1, Math.ceil(distance(from, to) / MAX_STEP));
      for (let i = 0; i <= steps; i++) {
        const fraction = i / steps;
        if (!walkable({x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction})) return false;
      }
      return true;
    }
    function state() {
      return Object.freeze({
        x, y, facing, moving, mode, paused: pauseReason !== null,
        pauseReason, roomId, nearId, destinationId, lastError, destroyed,
        path: Object.freeze(route.map(position => Object.freeze({...position})))
      });
    }
    function portalCopy(portal) { return portal ? Object.freeze({...portal, exit: Object.freeze({...portal.exit})}) : null; }
    function call(name, ...args) { if (typeof callbacks[name] === 'function') callbacks[name](...args); }
    function setMode(next) {
      if (mode === next) return;
      mode = next;
      call('onMode', mode, state());
    }
    function emitMove(force = false) {
      const signature = [x, y, facing, moving, mode, nearId, destinationId, lastError].join('|');
      if (force || signature !== lastMoveSignature) {
        lastMoveSignature = signature;
        call('onMove', state());
      }
    }
    function cancelFrame() { if (raf) win.cancelAnimationFrame(raf); raf = 0; lastTime = null; }
    function wake() { if (!raf && !destroyed && pauseReason === null && !doc.hidden && (keys.size || route.length)) raf = win.requestAnimationFrame(tick); }
    function focusMap() { if (typeof element.focus === 'function') element.focus({preventScroll: true}); }
    function hasDialog() {
      if (doc.querySelector('dialog[open]')) return true;
      // aria-modal is often left on a closed native dialog; only visible custom
      // modal elements should suspend the map's keyboard shortcuts.
      return [...doc.querySelectorAll('[aria-modal="true"]')].some(modal => modal.tagName !== 'DIALOG' && !modal.hidden && modal.getAttribute('aria-hidden') !== 'true' && modal.getClientRects().length > 0);
    }
    function interactive(target) {
      return Boolean(target?.closest?.('button, a[href], input, textarea, select, summary, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="tab"], [role="menuitem"], [data-no-movement]'));
    }
    function keyboardScope(event) {
      if (hasDialog()) return false;
      if (event?.composedPath?.().some(interactive)) return false;
      const active = doc.activeElement;
      return !active || active === doc.body || ((active === element || element.contains(active)) && !interactive(active));
    }
    function clearKeys() {
      keys.clear();
      if (!route.length && pauseReason === null) { moving = false; setMode('idle'); cancelFrame(); emitMove(); }
    }
    function updateNear(force = false) {
      const position = {x, y};
      let closest = null, closestDistance = Infinity;
      portals.forEach(portal => {
        const delta = distance(position, portal);
        if (delta <= portal.radius && delta < closestDistance) { closest = portal; closestDistance = delta; }
      });
      if (blockedAutoId != null) {
        const blocked = portals.get(blockedAutoId);
        if (!blocked || distance(position, blocked) > blocked.radius + FOOT_RADIUS) blockedAutoId = null;
      }
      const nextId = closest?.id ?? null;
      if (force || nextId !== nearId) {
        nearId = nextId;
        call('onNear', portalCopy(closest), state());
      }
      return closest;
    }
    function enterPortal(portal) {
      if (!portal || destroyed || roomId !== null) return false;
      roomId = portal.id; nearId = portal.id; pauseReason = 'room';
      route = []; destinationId = null; keys.clear(); moving = false; lastError = null;
      cancelFrame(); setMode('room'); emitMove(true);
      call('onEnter', portal.id, state());
      return true;
    }
    function maybeAutoEnter() {
      if (pauseReason !== null) return false;
      const portal = updateNear();
      if (!portal || portal.id === blockedAutoId || (destinationId !== null && destinationId !== portal.id)) return false;
      return distance({x, y}, portal) <= portal.autoRadius ? enterPortal(portal) : false;
    }
    function face(dx, dy) {
      if (Math.abs(dx) > Math.abs(dy)) facing = dx > 0 ? 'right' : 'left';
      else if (Math.abs(dy) > EPSILON) facing = dy > 0 ? 'down' : 'up';
    }
    function move(dx, dy, slide) {
      const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / MAX_STEP));
      const sx = dx / steps, sy = dy / steps;
      for (let i = 0; i < steps; i++) {
        if (walkable({x: x + sx, y: y + sy})) { x += sx; y += sy; }
        else if (slide) {
          if (Math.abs(sx) > EPSILON && walkable({x: x + sx, y})) x += sx;
          if (Math.abs(sy) > EPSILON && walkable({x, y: y + sy})) y += sy;
        } else return false;
        if (maybeAutoEnter()) return true;
      }
      return true;
    }
    function stopRoute(error = null) {
      route = []; destinationId = null; moving = false; lastError = error;
      if (pauseReason === null) setMode(keys.size ? 'walking' : 'idle');
    }
    function tick(time) {
      raf = 0;
      if (destroyed || pauseReason !== null || doc.hidden) { lastTime = null; return; }
      const dt = lastTime === null ? 1 / 60 : Math.min(.04, Math.max(0, (time - lastTime) / 1000));
      lastTime = time;
      const before = {x, y};
      if (route.length) {
        let budget = speed * dt;
        while (budget > EPSILON && route.length && pauseReason === null) {
          const target = route[0], remaining = distance({x, y}, target);
          if (remaining <= EPSILON) { route.shift(); continue; }
          const amount = Math.min(remaining, budget), dx = (target.x - x) / remaining * amount, dy = (target.y - y) / remaining * amount;
          face(dx, dy);
          if (!move(dx, dy, false)) { stopRoute('route-blocked'); break; }
          budget -= amount;
          if (pauseReason !== null) break;
          if (amount >= remaining - EPSILON) route.shift();
        }
        if (!route.length && destinationId !== null && pauseReason === null) {
          const destination = portals.get(destinationId);
          if (destination && distance({x, y}, destination) <= destination.radius) enterPortal(destination);
          else stopRoute('destination-not-reached');
        }
      } else if (keys.size) {
        const held = new Set(keys.values());
        let dx = Number(held.has('right')) - Number(held.has('left'));
        let dy = Number(held.has('down')) - Number(held.has('up'));
        const length = Math.hypot(dx, dy);
        if (length) {
          dx /= length; dy /= length; face(dx, dy);
          move(dx * speed * dt, dy * speed * dt, true);
        }
      }
      if (pauseReason === null) {
        moving = distance(before, {x, y}) > EPSILON;
        setMode(route.length ? 'route' : keys.size && moving ? 'walking' : 'idle');
        updateNear(); emitMove();
      }
      wake();
    }
    function keyInfo(key) {
      const token = String(key || '').toLowerCase();
      return directionKeys[token] ? {token, direction: directionKeys[token]} : null;
    }
    function direction(key, pressed, focus) {
      const info = keyInfo(key);
      if (!info || destroyed) return false;
      if (!pressed) { keys.delete(info.token); if (!keys.size && !route.length) clearKeys(); return true; }
      if (pauseReason !== null || hasDialog()) return false;
      if (focus) focusMap();
      if (route.length || destinationId !== null) stopRoute();
      keys.set(info.token, info.direction); lastError = null;
      setMode('walking'); wake(); return true;
    }
    function nodeEdge(a, b) {
      if (!edgeCache.has(a.id)) edgeCache.set(a.id, new Map());
      const cached = edgeCache.get(a.id);
      if (!cached.has(b.id)) cached.set(b.id, lineWalkable(a, b));
      return cached.get(b.id);
    }
    function approach(portal) {
      if (walkable(portal)) return {x: portal.x, y: portal.y};
      if (walkable(portal.exit) && distance(portal.exit, portal) <= portal.radius) return {...portal.exit};
      const towardExit = Math.atan2(portal.exit.y - portal.y, portal.exit.x - portal.x);
      for (let radius = 2; radius <= portal.radius; radius += 2) {
        for (let i = 0; i < 16; i++) {
          const angle = towardExit + i * Math.PI / 8;
          const candidate = {x: portal.x + Math.cos(angle) * radius, y: portal.y + Math.sin(angle) * radius};
          if (walkable(candidate)) return candidate;
        }
      }
      return null;
    }
    function routeTo(portal) {
      const target = approach(portal), current = {x, y};
      if (!target) return null;
      if (!nodes.size) return lineWalkable(current, target) ? [target] : null;
      const allowed = [...nodes.values()].filter(walkable);
      const goalIds = portal.node != null ? new Set([portal.node]) : new Set(allowed.filter(node => lineWalkable(node, target)).map(node => node.id));
      const costs = new Map(), previous = new Map(), pending = new Set();
      allowed.forEach(node => {
        if (lineWalkable(current, node)) { costs.set(node.id, distance(current, node)); previous.set(node.id, null); }
        else costs.set(node.id, Infinity);
        pending.add(node.id);
      });
      let bestGoal = null, bestCost = Infinity;
      while (pending.size) {
        let nextId = null, nextCost = Infinity;
        pending.forEach(id => { if (costs.get(id) < nextCost) { nextCost = costs.get(id); nextId = id; } });
        if (nextId === null || !Number.isFinite(nextCost)) break;
        pending.delete(nextId);
        const next = nodes.get(nextId);
        if (goalIds.has(nextId) && lineWalkable(next, target)) {
          const completeCost = nextCost + distance(next, target);
          if (completeCost < bestCost) { bestCost = completeCost; bestGoal = nextId; }
        }
        if (nextCost > bestCost) break;
        next.links.forEach(id => {
          const neighbour = nodes.get(id);
          if (!neighbour || !pending.has(id) || !nodeEdge(next, neighbour)) return;
          const cost = nextCost + distance(next, neighbour);
          if (cost < costs.get(id)) { costs.set(id, cost); previous.set(id, nextId); }
        });
      }
      if (bestGoal === null) return null;
      const result = [target];
      for (let id = bestGoal; id !== null; id = previous.get(id)) {
        const node = nodes.get(id);
        result.unshift({x: node.x, y: node.y});
      }
      return result.filter((position, index, all) => index === 0 ? distance(position, current) > EPSILON : distance(position, all[index - 1]) > EPSILON);
    }

    function goTo(id) {
      if (destroyed || roomId !== null || !portals.has(id)) return false;
      const portal = portals.get(id), nextRoute = routeTo(portal);
      if (!nextRoute) { lastError = 'unreachable-room'; emitMove(true); return false; }
      keys.clear(); route = nextRoute; destinationId = id; pauseReason = null; lastError = null;
      // A deliberately selected room may be re-entered without first walking away.
      if (!route.length && distance({x, y}, portal) <= portal.radius) return enterPortal(portal);
      cancelFrame(); setMode('route'); emitMove(true); wake(); return true;
    }
    function enter() {
      if (destroyed || pauseReason !== null) return false;
      return enterPortal(updateNear());
    }
    function leaveRoom(id = roomId) {
      const portal = portals.get(id);
      if (destroyed || !portal || (roomId !== null && roomId !== id) || !walkable(portal.exit)) return false;
      cancelFrame(); keys.clear(); route = []; destinationId = null;
      x = portal.exit.x; y = portal.exit.y; roomId = null; pauseReason = null;
      moving = false; blockedAutoId = portal.id; lastError = null;
      face(x - portal.x, y - portal.y);
      setMode('idle'); emitMove(true); updateNear(true); focusMap(); return true;
    }
    function pause(reason = 'manual') {
      if (destroyed) return false;
      if (reason === false) {
        if (roomId !== null) return false;
        pauseReason = null; lastTime = null;
        setMode(route.length ? 'route' : 'idle'); emitMove(true); wake(); return true;
      }
      keys.clear(); moving = false; pauseReason = String(reason || 'manual');
      cancelFrame(); setMode(roomId !== null ? 'room' : 'paused'); emitMove(true); return true;
    }
    function reset() {
      if (destroyed) return false;
      cancelFrame(); keys.clear(); route = []; destinationId = null;
      x = start.x; y = start.y; facing = 'down'; moving = false;
      pauseReason = null; roomId = null; blockedAutoId = null; lastError = null;
      setMode('idle'); emitMove(true); updateNear(true); focusMap(); return true;
    }
    function onKeyDown(event) {
      if (destroyed || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || !keyboardScope(event)) return;
      const key = event.code || event.key;
      if (keyInfo(key)) {
        if (pauseReason !== null) return;
        event.preventDefault(); direction(key, true, false);
      } else if ((event.key === 'Enter' || event.code === 'Enter') && !event.repeat && pauseReason === null && updateNear()) {
        event.preventDefault(); enter();
      }
    }
    function onKeyUp(event) { direction(event.code || event.key, false, false); }
    function onVisibility() { clearKeys(); if (doc.hidden) cancelFrame(); else wake(); }
    function onFocus() { if (!keyboardScope()) clearKeys(); }
    function onPointer(event) { if (!interactive(event.target) && !hasDialog()) focusMap(); }
    function destroy() {
      if (destroyed) return;
      destroyed = true; cancelFrame(); keys.clear(); route = []; destinationId = null; moving = false;
      doc.removeEventListener('keydown', onKeyDown);
      doc.removeEventListener('keyup', onKeyUp);
      doc.removeEventListener('visibilitychange', onVisibility);
      doc.removeEventListener('focusin', onFocus);
      win.removeEventListener('blur', clearKeys);
      element.removeEventListener('pointerdown', onPointer);
    }
    doc.addEventListener('keydown', onKeyDown);
    doc.addEventListener('keyup', onKeyUp);
    doc.addEventListener('visibilitychange', onVisibility);
    doc.addEventListener('focusin', onFocus);
    win.addEventListener('blur', clearKeys);
    element.addEventListener('pointerdown', onPointer);

    const api = Object.freeze({getState: state, goTo, setDirection: (key, pressed) => direction(key, Boolean(pressed), true), enter, leaveRoom, reset, pause, destroy});
    emitMove(true); updateNear(true);
    return api;
  }
  global.CampusMovement = Object.freeze({create});
})(window);
