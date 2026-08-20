import path from "node:path";

import {
  DEFAULT_WAIT_EXPIRY_MS,
  DEFAULT_WAIT_REMINDER_MS,
} from "./constants.mjs";
import {
  formatContinuationPrompt,
  hashToken,
  makeCorrelationToken,
  makeId,
  makeOpaqueToken,
  parseContinuationPrompt,
  stableJson,
} from "./protocol.mjs";

const REQUIRED_PROPOSAL_KEYS = [
  "schema_version",
  "correlation_token",
  "interaction_kind",
  "task_goal",
  "outcome",
  "recommended_next",
];
const SUPPORTED_REPAIR_KINDS = new Set(["decision_proposal_schema"]);

function requiredString(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw Object.assign(new Error(`${name}_required`), { code: "invalid_request" });
  }
  return value;
}

function clone(value) {
  return structuredClone(value);
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function actionFromProposal(proposalAction) {
  return {
    title: requiredString(proposalAction?.title, "action_title"),
    objective: requiredString(proposalAction?.objective, "action_objective"),
    constraints: Array.isArray(proposalAction?.constraints) ? clone(proposalAction.constraints) : [],
    done_when: Array.isArray(proposalAction?.done_when) ? clone(proposalAction.done_when) : [],
  };
}

function optionForAction(slot, kind, proposalAction, label) {
  const action = actionFromProposal(proposalAction);
  return {
    slot,
    kind,
    enabled: true,
    disabled_reason: null,
    option_id: makeId(`opt_${label}`),
    action_id: makeId(`act_${label}`),
    ...action,
  };
}

export class FakeCoordinator {
  constructor({
    reminderMs = DEFAULT_WAIT_REMINDER_MS,
    expiryMs = DEFAULT_WAIT_EXPIRY_MS,
    continuationTtlMs = DEFAULT_WAIT_EXPIRY_MS,
    now = () => Date.now(),
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  } = {}) {
    if (!(reminderMs > 0) || !(expiryMs > reminderMs)) {
      throw new Error("invalid_wait_deadlines");
    }
    this.reminderMs = reminderMs;
    this.expiryMs = expiryMs;
    this.continuationTtlMs = continuationTtlMs;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.projects = new Map();
    this.sessions = new Map();
    this.proposals = new Map();
    this.packets = new Map();
    this.interactions = new Map();
    this.continuations = new Map();
    this.dispatches = new Map();
    this.formatRepairBoundaries = new Set();
    this.events = [];
    this.eventSequence = 0;
  }

  emit(type, payload = {}) {
    const event = {
      seq: ++this.eventSequence,
      type,
      at: new Date(this.now()).toISOString(),
      payload: clone(payload),
    };
    this.events.push(event);
    return event;
  }

  findProject(cwd) {
    if (typeof cwd !== "string" || cwd.length === 0) return null;
    const candidate = path.resolve(cwd);
    let best = null;
    for (const project of this.projects.values()) {
      if (isWithin(project.cwd, candidate) && (!best || project.cwd.length > best.cwd.length)) {
        best = project;
      }
    }
    return best;
  }

  async handle(type, payload = {}) {
    switch (type) {
      case "enable_project":
        return this.enableProject(payload);
      case "session_start":
        return this.sessionStart(payload);
      case "user_prompt_submit":
        return this.userPromptSubmit(payload);
      case "emit_decision":
        return this.emitDecision(payload);
      case "stop":
        return this.stop(payload);
      case "select":
        return this.select(payload);
      case "permission_request":
        return this.permissionRequest(payload);
      case "issue_format_repair":
        return this.issueFormatRepair(payload);
      case "get_state":
        return this.getState();
      default:
        throw Object.assign(new Error(`unsupported_request_type:${type}`), {
          code: "unsupported_request_type",
        });
    }
  }

  enableProject(payload) {
    const cwd = path.resolve(requiredString(payload.cwd, "cwd"));
    const project = {
      project_id: payload.project_id ?? makeId("project"),
      cwd,
      enabled: payload.enabled !== false,
    };
    this.projects.set(cwd, project);
    this.emit("project_enabled", project);
    return clone(project);
  }

  sessionStart(payload) {
    const sessionId = requiredString(payload.session_id, "session_id");
    const project = this.findProject(payload.cwd);
    if (!project?.enabled) return { enabled: false };

    const previous = this.sessions.get(sessionId);
    const sameProject = previous?.project_id === project.project_id;
    if (previous && !sameProject) {
      this.retireSessionRouting(sessionId, "project_rebound");
    }
    this.sessions.set(sessionId, {
      ...previous,
      session_id: sessionId,
      project_id: project.project_id,
      cwd: path.resolve(payload.cwd),
      episode: sameProject ? previous.episode : null,
      latest_turn_id: sameProject ? previous.latest_turn_id : null,
      latest_prompt_id: sameProject ? previous.latest_prompt_id : null,
      correlation_token: sameProject ? previous.correlation_token ?? null : null,
    });
    this.emit("session_started", {
      session_id: sessionId,
      project_id: project.project_id,
      source: payload.source ?? null,
    });

    return {
      enabled: true,
      additionalContext:
        `Blabee M0 enabled for project ${project.project_id}. ` +
        "For completed work that has a concrete next decision, call blabee.emit_decision once with the exact Blabee identifiers. " +
        "Do not create a Blabee decision for explanations, architecture descriptions, or ordinary status answers.",
    };
  }

  userPromptSubmit(payload) {
    const sessionId = requiredString(payload.session_id, "session_id");
    const turnId = requiredString(payload.turn_id, "turn_id");
    const prompt = requiredString(payload.prompt, "prompt");
    const project = this.findProject(payload.cwd);
    if (!project?.enabled) return { enabled: false };

    let session = this.sessions.get(sessionId);
    if (!session) {
      session = {
        session_id: sessionId,
        project_id: project.project_id,
        cwd: path.resolve(payload.cwd),
        episode: null,
        latest_turn_id: null,
        latest_prompt_id: null,
      };
      this.sessions.set(sessionId, session);
    }
    if (session.project_id !== project.project_id) {
      return this.rejectContinuation("cross_project");
    }

    let envelope;
    try {
      envelope = parseContinuationPrompt(prompt);
    } catch (error) {
      return this.rejectContinuation(error.message);
    }

    if (envelope) {
      return this.acceptContinuation({ session, turnId, envelope });
    }

    this.invalidateSessionInteractions(sessionId, "new_human_prompt");
    const sourcePromptId = makeId("prompt");
    const episode = {
      episode_id: makeId("episode"),
      episode_root_prompt_id: sourcePromptId,
      episode_baseline_checkpoint_id: makeId("cp_before_prompt"),
      project_id: project.project_id,
      started_at_ms: this.now(),
    };
    const correlationToken = makeCorrelationToken({
      sessionId,
      turnId,
      promptId: sourcePromptId,
    });

    session.episode = episode;
    session.latest_turn_id = turnId;
    session.latest_prompt_id = sourcePromptId;
    session.correlation_token = correlationToken;
    this.emit("human_episode_started", {
      project_id: project.project_id,
      session_id: sessionId,
      source_turn_id: turnId,
      source_prompt_id: sourcePromptId,
      ...episode,
    });

    return {
      enabled: true,
      prompt_origin: "human",
      identifiers: {
        project_id: project.project_id,
        session_id: sessionId,
        source_turn_id: turnId,
        source_prompt_id: sourcePromptId,
        correlation_token: correlationToken,
        ...episode,
      },
      additionalContext: this.boundaryContext({
        origin: "human",
        projectId: project.project_id,
        sessionId,
        turnId,
        promptId: sourcePromptId,
        correlationToken,
        episode,
      }),
    };
  }

  boundaryContext({ origin, projectId, sessionId, turnId, promptId, correlationToken, episode }) {
    return (
      `Blabee boundary (${origin}): project_id=${projectId}; session_id=${sessionId}; ` +
      `source_turn_id=${turnId}; source_prompt_id=${promptId}; episode_id=${episode.episode_id}; ` +
      `episode_root_prompt_id=${episode.episode_root_prompt_id}; ` +
      `episode_baseline_checkpoint_id=${episode.episode_baseline_checkpoint_id}; ` +
      `correlation_token=${correlationToken}. Use these exact values if calling blabee.emit_decision.`
    );
  }

  rejectContinuation(reason) {
    this.emit("continuation_rejected", { reason });
    return {
      enabled: true,
      decision: "block",
      reason: `Blabee rejected reserved continuation (${reason}); no automatic work was started.`,
    };
  }

  acceptContinuation({ session, turnId, envelope }) {
    const tokenHash = hashToken(envelope.continuation_token);
    const record = this.continuations.get(tokenHash);
    if (!record) return this.rejectContinuation("unknown_token");
    if (record.dispatch_mode !== "submitted_envelope") {
      return this.rejectContinuation("dispatch_mode_mismatch");
    }
    if (record.consumed) return this.rejectContinuation("token_replayed");
    if (record.expires_at_ms <= this.now()) return this.rejectContinuation("token_expired");

    const bound = record.envelope;
    const comparisons = [
      [envelope.session_id, bound.session_id, "envelope_session_mismatch"],
      [envelope.project_id, bound.project_id, "envelope_project_mismatch"],
      [envelope.episode_id, bound.episode_id, "envelope_episode_mismatch"],
      [envelope.episode_root_prompt_id, bound.episode_root_prompt_id, "root_prompt_mismatch"],
      [
        envelope.episode_baseline_checkpoint_id,
        bound.episode_baseline_checkpoint_id,
        "baseline_mismatch",
      ],
      [envelope.parent_turn_id, bound.parent_turn_id, "envelope_parent_turn_mismatch"],
      [envelope.parent_prompt_id, bound.parent_prompt_id, "envelope_parent_prompt_mismatch"],
      [envelope.continuation_origin, bound.continuation_origin, "continuation_origin_mismatch"],
    ];
    if (bound.continuation_origin === "pet_action") {
      comparisons.push(
        [envelope.interaction_id, bound.interaction_id, "interaction_mismatch"],
        [envelope.packet_id, bound.packet_id, "packet_mismatch"],
        [envelope.revision, bound.revision, "revision_mismatch"],
        [envelope.option_id, bound.option_id, "option_mismatch"],
        [envelope.action_id, bound.action_id, "action_mismatch"],
        [stableJson(envelope.action), stableJson(bound.action), "action_body_mismatch"],
      );
    } else {
      comparisons.push(
        [envelope.repair_request_id, bound.repair_request_id, "repair_request_mismatch"],
        [envelope.repair_attempt, 1, "repair_attempt_mismatch"],
        [envelope.max_repair_attempts, 1, "repair_limit_mismatch"],
      );
    }
    const mismatch = comparisons.find(([actual, expected]) => actual !== expected);
    if (mismatch) return this.rejectContinuation(mismatch[2]);
    const submittedEnvelope = clone(envelope);
    delete submittedEnvelope.continuation_token;
    if (stableJson(submittedEnvelope) !== stableJson(bound)) {
      return this.rejectContinuation("envelope_body_mismatch");
    }
    if (session.session_id !== bound.session_id) return this.rejectContinuation("cross_session");
    if (session.project_id !== bound.project_id) return this.rejectContinuation("cross_project");
    if (session.episode?.episode_id !== bound.episode_id) return this.rejectContinuation("cross_episode");
    if (session.latest_turn_id !== bound.parent_turn_id) {
      return this.rejectContinuation("parent_turn_mismatch");
    }
    if (session.latest_prompt_id !== bound.parent_prompt_id) {
      return this.rejectContinuation("parent_prompt_mismatch");
    }

    record.consumed = true;
    record.consumption_emitted = true;
    const promptId = envelope.continuation_id;
    const correlationToken = makeCorrelationToken({
      sessionId: session.session_id,
      turnId,
      promptId,
    });
    session.latest_turn_id = turnId;
    session.latest_prompt_id = promptId;
    session.correlation_token = correlationToken;
    this.emit("continuation_consumed", {
      continuation_id: envelope.continuation_id,
      continuation_origin: envelope.continuation_origin,
      project_id: session.project_id,
      session_id: session.session_id,
      source_turn_id: turnId,
      source_prompt_id: promptId,
      episode_id: session.episode.episode_id,
    });

    return {
      enabled: true,
      prompt_origin: envelope.continuation_origin,
      identifiers: {
        project_id: session.project_id,
        session_id: session.session_id,
        source_turn_id: turnId,
        source_prompt_id: promptId,
        correlation_token: correlationToken,
        ...session.episode,
      },
      additionalContext: this.boundaryContext({
        origin: envelope.continuation_origin,
        projectId: session.project_id,
        sessionId: session.session_id,
        turnId,
        promptId,
        correlationToken,
        episode: session.episode,
      }),
    };
  }

  emitDecision(payload) {
    const projectId = requiredString(payload.project_id, "project_id");
    const sessionId = requiredString(payload.session_id, "session_id");
    const turnId = requiredString(payload.source_turn_id, "source_turn_id");
    const promptId = requiredString(payload.source_prompt_id, "source_prompt_id");
    const episodeId = requiredString(payload.episode_id, "episode_id");
    const correlationToken = requiredString(payload.correlation_token, "correlation_token");
    const session = this.sessions.get(sessionId);
    if (!session || session.project_id !== projectId) throw this.invalidBinding("project_or_session");
    if (session.episode?.episode_id !== episodeId) throw this.invalidBinding("episode");
    if (session.latest_turn_id !== turnId) throw this.invalidBinding("turn");
    if (session.latest_prompt_id !== promptId) throw this.invalidBinding("prompt");
    if (session.correlation_token !== correlationToken) throw this.invalidBinding("correlation_token");

    const proposal = payload.proposal;
    if (!proposal || typeof proposal !== "object") {
      throw Object.assign(new Error("proposal_required"), { code: "invalid_proposal" });
    }
    for (const key of REQUIRED_PROPOSAL_KEYS) {
      if (proposal[key] === undefined || proposal[key] === null) {
        throw Object.assign(new Error(`proposal_${key}_required`), { code: "invalid_proposal" });
      }
    }
    if (proposal.schema_version !== "1.0" || proposal.interaction_kind !== "blabee_decision") {
      throw Object.assign(new Error("unsupported_proposal_contract"), { code: "invalid_proposal" });
    }
    if (proposal.correlation_token !== correlationToken) {
      throw this.invalidBinding("proposal_correlation_token");
    }

    const key = this.turnKey(sessionId, turnId);
    if (this.proposals.has(key)) {
      throw Object.assign(new Error("proposal_already_exists_for_turn"), {
        code: "proposal_conflict",
      });
    }

    const packet = this.buildPacket({ session, turnId, promptId, proposal });
    this.proposals.set(key, { packet_id: packet.packet_id, proposal: clone(proposal) });
    this.packets.set(packet.packet_id, packet);
    this.emit("decision_proposal_received", {
      project_id: projectId,
      session_id: sessionId,
      source_turn_id: turnId,
      source_prompt_id: promptId,
      episode_id: episodeId,
      packet_id: packet.packet_id,
      revision: packet.revision,
      proposal: clone(proposal),
    });
    return { accepted: true, packet: clone(packet) };
  }

  invalidBinding(field) {
    return Object.assign(new Error(`proposal_binding_mismatch:${field}`), {
      code: "proposal_binding_mismatch",
    });
  }

  buildPacket({ session, turnId, promptId, proposal }) {
    const packetId = makeId("packet");
    const interactionId = makeId("interaction");
    const checkpointId = session.episode.episode_baseline_checkpoint_id;
    const choices = [
      optionForAction(1, "recommended_action", proposal.recommended_next, "recommended"),
    ];
    if (proposal.alternative_next) {
      choices.push(optionForAction(2, "alternative_action", proposal.alternative_next, "alternative"));
    } else {
      choices.push({
        slot: 2,
        kind: "alternative_action",
        enabled: false,
        disabled_reason: "no_safe_meaningful_alternative",
        option_id: makeId("opt_alternative_disabled"),
        action_id: null,
      });
    }
    choices.push(
      {
        slot: 3,
        kind: "pause",
        enabled: true,
        disabled_reason: null,
        option_id: makeId("opt_pause"),
        action_id: makeId("act_pause"),
      },
      {
        slot: 4,
        kind: "rollback",
        enabled: true,
        disabled_reason: null,
        option_id: makeId("opt_rollback"),
        action_id: makeId("act_rollback"),
        target_checkpoint_id: checkpointId,
      },
    );

    return {
      schema_version: "1.0",
      interaction_id: interactionId,
      packet_id: packetId,
      revision: 1,
      project_id: session.project_id,
      session_id: session.session_id,
      source_turn_id: turnId,
      source_prompt_id: promptId,
      episode_id: session.episode.episode_id,
      episode_root_prompt_id: session.episode.episode_root_prompt_id,
      episode_baseline_checkpoint_id: checkpointId,
      summary: proposal.outcome?.summary ?? proposal.task_goal,
      checkpoint: { id: checkpointId, coverage: "m0_intent_only" },
      choices,
      state: "proposed",
    };
  }

  stop(payload) {
    const sessionId = requiredString(payload.session_id, "session_id");
    const turnId = requiredString(payload.turn_id, "turn_id");
    const turnKey = this.turnKey(sessionId, turnId);
    const dispatch = this.dispatches.get(turnKey);
    if (dispatch) return this.completeDispatchedContinuation(payload, dispatch);

    const proposalRecord = this.proposals.get(turnKey);
    if (!proposalRecord) return { status: "no_proposal" };

    const packet = this.packets.get(proposalRecord.packet_id);
    if (!packet || packet.session_id !== sessionId || packet.source_turn_id !== turnId) {
      return { status: "no_proposal" };
    }
    if (packet.state !== "proposed") return { status: "stale_packet" };

    packet.state = "waiting";
    packet.wait_started_at_ms = this.now();
    packet.expires_at = new Date(packet.wait_started_at_ms + this.expiryMs).toISOString();
    const interaction = {
      interaction_id: packet.interaction_id,
      packet_id: packet.packet_id,
      revision: packet.revision,
      project_id: packet.project_id,
      session_id: packet.session_id,
      episode_id: packet.episode_id,
      state: "waiting",
      resolve: null,
      reminder_timer: null,
      expiry_timer: null,
    };
    this.interactions.set(interaction.interaction_id, interaction);
    this.emit("decision_wait_started", this.publicInteraction(interaction));

    return new Promise((resolve) => {
      interaction.resolve = resolve;
      interaction.reminder_timer = this.setTimer(() => {
        if (interaction.state !== "waiting") return;
        this.emit("decision_wait_reminder", this.publicInteraction(interaction));
      }, this.reminderMs);
      interaction.expiry_timer = this.setTimer(() => {
        if (interaction.state !== "waiting") return;
        interaction.state = "expired";
        packet.state = "expired";
        this.emit("decision_wait_expired", this.publicInteraction(interaction));
        this.emit("resume_capsule_saved", {
          reason: "decision_timeout",
          interaction_id: packet.interaction_id,
          packet_id: packet.packet_id,
          project_id: packet.project_id,
          session_id: packet.session_id,
          episode_id: packet.episode_id,
          resume_capsule: { summary: packet.summary },
        });
        resolve({ status: "expired" });
      }, this.expiryMs);
    });
  }

  select(payload) {
    const interaction = this.interactions.get(requiredString(payload.interaction_id, "interaction_id"));
    if (!interaction || interaction.state !== "waiting") {
      throw Object.assign(new Error("interaction_not_waiting"), { code: "stale_selection" });
    }
    const packet = this.packets.get(interaction.packet_id);
    const fields = ["project_id", "session_id", "episode_id", "packet_id", "revision"];
    for (const field of fields) {
      if (payload[field] !== packet[field]) {
        throw Object.assign(new Error(`selection_binding_mismatch:${field}`), {
          code: "selection_binding_mismatch",
        });
      }
    }
    const option = packet.choices.find((choice) => choice.option_id === payload.option_id);
    if (!option) {
      throw Object.assign(new Error("selection_binding_mismatch:option_id"), {
        code: "selection_binding_mismatch",
      });
    }
    if (!option.enabled) {
      throw Object.assign(new Error(`option_disabled:${option.disabled_reason}`), {
        code: "option_disabled",
      });
    }

    interaction.state = "claimed";
    packet.state = "claimed";
    this.clearTimer(interaction.reminder_timer);
    this.clearTimer(interaction.expiry_timer);

    let stopResult;
    let outcome;
    if (option.slot === 1 || option.slot === 2) {
      const envelope = this.issuePetContinuation(packet, option);
      const dispatch = {
        state: "dispatched",
        project_id: packet.project_id,
        session_id: packet.session_id,
        turn_id: packet.source_turn_id,
        source_prompt_id: packet.source_prompt_id,
        episode_id: packet.episode_id,
        episode_root_prompt_id: packet.episode_root_prompt_id,
        episode_baseline_checkpoint_id: packet.episode_baseline_checkpoint_id,
        interaction_id: packet.interaction_id,
        packet_id: packet.packet_id,
        revision: packet.revision,
        option_id: option.option_id,
        action_id: option.action_id,
        continuation_id: envelope.continuation_id,
        token_hash: hashToken(envelope.continuation_token),
      };
      this.dispatches.set(this.turnKey(packet.session_id, packet.source_turn_id), dispatch);
      interaction.state = "continuation_dispatched";
      packet.state = "continuation_dispatched";
      stopResult = {
        decision: "block",
        reason: formatContinuationPrompt(envelope),
      };
      outcome = {
        kind: "continuation",
        continuation_id: envelope.continuation_id,
        continuation_prompt: stopResult.reason,
      };
      this.emit("pet_action_selected", {
        interaction_id: packet.interaction_id,
        packet_id: packet.packet_id,
        revision: packet.revision,
        option_id: option.option_id,
        action_id: option.action_id,
        continuation_id: envelope.continuation_id,
      });
      this.emit("continuation_dispatched", this.publicDispatch(dispatch));
    } else if (option.slot === 3) {
      interaction.state = "paused";
      packet.state = "paused";
      stopResult = { status: "paused" };
      outcome = { kind: "pause" };
      this.emit("episode_paused", {
        interaction_id: packet.interaction_id,
        packet_id: packet.packet_id,
        project_id: packet.project_id,
        session_id: packet.session_id,
        episode_id: packet.episode_id,
        resume_capsule: { summary: packet.summary },
      });
    } else {
      interaction.state = "rollback_intent";
      packet.state = "rollback_intent";
      stopResult = {
        status: "rollback_intent",
        episode_id: packet.episode_id,
        target_checkpoint_id: option.target_checkpoint_id,
      };
      outcome = clone(stopResult);
      this.emit("rollback_intent", {
        interaction_id: packet.interaction_id,
        packet_id: packet.packet_id,
        project_id: packet.project_id,
        session_id: packet.session_id,
        episode_id: packet.episode_id,
        episode_root_prompt_id: packet.episode_root_prompt_id,
        target_checkpoint_id: option.target_checkpoint_id,
      });
    }
    interaction.resolve(stopResult);
    return { accepted: true, outcome };
  }

  issuePetContinuation(packet, option) {
    const token = makeOpaqueToken();
    const expiresAtMs = this.now() + this.continuationTtlMs;
    const envelope = {
      schema_version: "1.0",
      kind: "blabee_episode_continuation",
      continuation_origin: "pet_action",
      continuation_id: makeId("continuation"),
      continuation_token: token,
      interaction_id: packet.interaction_id,
      project_id: packet.project_id,
      session_id: packet.session_id,
      episode_id: packet.episode_id,
      episode_root_prompt_id: packet.episode_root_prompt_id,
      episode_baseline_checkpoint_id: packet.episode_baseline_checkpoint_id,
      parent_turn_id: packet.source_turn_id,
      parent_prompt_id: packet.source_prompt_id,
      packet_id: packet.packet_id,
      revision: packet.revision,
      option_id: option.option_id,
      action_id: option.action_id,
      action: {
        title: option.title,
        objective: option.objective,
        constraints: clone(option.constraints),
        done_when: clone(option.done_when),
      },
      expires_at: new Date(expiresAtMs).toISOString(),
    };
    this.storeContinuation(token, envelope, expiresAtMs, "same_turn_stop");
    return envelope;
  }

  completeDispatchedContinuation(payload, dispatch) {
    if (payload.stop_hook_active !== true) {
      this.emit("continuation_completion_rejected", {
        ...this.publicDispatch(dispatch),
        reason: "stop_hook_not_active",
      });
      return {
        status: "continuation_completion_rejected",
        reason: "stop_hook_not_active",
      };
    }
    if (dispatch.state === "completed") {
      return { status: "continuation_already_completed" };
    }
    if (dispatch.state !== "dispatched") {
      return { status: "stale_continuation_dispatch" };
    }

    dispatch.state = "completed";
    const packet = this.packets.get(dispatch.packet_id);
    if (packet) packet.state = "completed";
    const interaction = this.interactions.get(dispatch.interaction_id);
    if (interaction) interaction.state = "completed";

    const continuation = this.continuations.get(dispatch.token_hash);
    if (continuation) {
      continuation.consumed = true;
      if (!continuation.consumption_emitted) {
        continuation.consumption_emitted = true;
        this.emit("continuation_consumed", {
          continuation_id: dispatch.continuation_id,
          continuation_origin: "pet_action",
          dispatch_mode: "same_turn_stop",
          project_id: dispatch.project_id,
          session_id: dispatch.session_id,
          source_turn_id: dispatch.turn_id,
          source_prompt_id: dispatch.source_prompt_id,
          episode_id: dispatch.episode_id,
        });
      }
    }
    this.emit("continuation_completed", this.publicDispatch(dispatch));
    return { status: "continuation_completed" };
  }

  issueFormatRepair(payload) {
    const session = this.sessions.get(requiredString(payload.session_id, "session_id"));
    if (!session?.episode) throw this.invalidBinding("session_or_episode");
    if (payload.project_id !== session.project_id) throw this.invalidBinding("project");
    if (payload.parent_turn_id !== session.latest_turn_id) throw this.invalidBinding("turn");
    if (payload.parent_prompt_id !== session.latest_prompt_id) throw this.invalidBinding("prompt");

    const repairKind = payload.repair_kind ?? "decision_proposal_schema";
    if (!SUPPORTED_REPAIR_KINDS.has(repairKind)) {
      throw Object.assign(new Error(`unsupported_repair_kind:${repairKind}`), {
        code: "invalid_request",
      });
    }
    const boundaryKey = [
      session.project_id,
      session.session_id,
      session.episode.episode_id,
      session.latest_turn_id,
      session.latest_prompt_id,
    ].join("\0");
    if (this.formatRepairBoundaries.has(boundaryKey)) {
      throw Object.assign(new Error("format_repair_limit_reached"), {
        code: "format_repair_limit_reached",
      });
    }
    this.formatRepairBoundaries.add(boundaryKey);

    const token = makeOpaqueToken();
    const expiresAtMs = this.now() + this.continuationTtlMs;
    const envelope = {
      schema_version: "1.0",
      kind: "blabee_episode_continuation",
      continuation_origin: "internal_format_repair",
      continuation_id: makeId("continuation"),
      continuation_token: token,
      project_id: session.project_id,
      session_id: session.session_id,
      episode_id: session.episode.episode_id,
      episode_root_prompt_id: session.episode.episode_root_prompt_id,
      episode_baseline_checkpoint_id: session.episode.episode_baseline_checkpoint_id,
      parent_turn_id: session.latest_turn_id,
      parent_prompt_id: session.latest_prompt_id,
      repair_request_id: makeId("repair"),
      repair_kind: repairKind,
      repair_attempt: 1,
      max_repair_attempts: 1,
      expires_at: new Date(expiresAtMs).toISOString(),
    };
    this.storeContinuation(token, envelope, expiresAtMs, "submitted_envelope");
    this.emit("format_repair_issued", {
      repair_request_id: envelope.repair_request_id,
      session_id: envelope.session_id,
      episode_id: envelope.episode_id,
    });
    return { continuation_prompt: formatContinuationPrompt(envelope), envelope };
  }

  permissionRequest(payload) {
    const sessionId = requiredString(payload.session_id, "session_id");
    this.emit("native_permission_notice", {
      session_id: sessionId,
      turn_id: payload.turn_id ?? null,
      cwd: payload.cwd ?? null,
      tool_name: payload.tool_name ?? null,
      permission_mode: payload.permission_mode ?? null,
    });
    return { notified: true, response_owner: "codex_native_ui" };
  }

  getState() {
    return {
      projects: [...this.projects.values()].map(clone),
      sessions: [...this.sessions.values()].map((session) => clone(session)),
      packets: [...this.packets.values()].map(clone),
      interactions: [...this.interactions.values()].map((interaction) =>
        this.publicInteraction(interaction),
      ),
      dispatches: [...this.dispatches.values()].map((dispatch) => this.publicDispatch(dispatch)),
      events: clone(this.events),
      deadlines: {
        reminder_ms: this.reminderMs,
        expiry_ms: this.expiryMs,
      },
    };
  }

  publicInteraction(interaction) {
    const packet = this.packets.get(interaction.packet_id);
    return {
      interaction_id: interaction.interaction_id,
      packet_id: interaction.packet_id,
      revision: interaction.revision,
      project_id: interaction.project_id,
      session_id: interaction.session_id,
      episode_id: interaction.episode_id,
      state: interaction.state,
      choices: packet ? clone(packet.choices) : [],
    };
  }

  publicDispatch(dispatch) {
    return {
      state: dispatch.state,
      project_id: dispatch.project_id,
      session_id: dispatch.session_id,
      turn_id: dispatch.turn_id,
      episode_id: dispatch.episode_id,
      interaction_id: dispatch.interaction_id,
      packet_id: dispatch.packet_id,
      revision: dispatch.revision,
      option_id: dispatch.option_id,
      action_id: dispatch.action_id,
      continuation_id: dispatch.continuation_id,
    };
  }

  turnKey(sessionId, turnId) {
    return `${sessionId}\0${turnId}`;
  }

  storeContinuation(token, envelope, expiresAtMs, dispatchMode) {
    const sealedEnvelope = clone(envelope);
    delete sealedEnvelope.continuation_token;
    this.continuations.set(hashToken(token), {
      envelope: sealedEnvelope,
      expires_at_ms: expiresAtMs,
      dispatch_mode: dispatchMode,
      consumed: false,
      consumption_emitted: false,
    });
  }

  invalidateSessionInteractions(sessionId, reason) {
    for (const interaction of this.interactions.values()) {
      if (interaction.session_id !== sessionId || interaction.state !== "waiting") continue;
      interaction.state = "superseded";
      this.clearTimer(interaction.reminder_timer);
      this.clearTimer(interaction.expiry_timer);
      const packet = this.packets.get(interaction.packet_id);
      if (packet) packet.state = "superseded";
      this.emit("decision_wait_superseded", {
        ...this.publicInteraction(interaction),
        reason,
      });
      interaction.resolve?.({ status: "superseded", reason });
    }
    for (const dispatch of this.dispatches.values()) {
      if (dispatch.session_id !== sessionId || dispatch.state !== "dispatched") continue;
      dispatch.state = "superseded";
      const packet = this.packets.get(dispatch.packet_id);
      if (packet) packet.state = "superseded";
      const interaction = this.interactions.get(dispatch.interaction_id);
      if (interaction) interaction.state = "superseded";
      this.emit("continuation_dispatch_superseded", {
        ...this.publicDispatch(dispatch),
        reason,
      });
    }
  }

  retireSessionRouting(sessionId, reason) {
    this.invalidateSessionInteractions(sessionId, reason);
    for (const [key, proposal] of this.proposals) {
      const packet = this.packets.get(proposal.packet_id);
      if (packet?.session_id !== sessionId) continue;
      packet.state = "superseded";
      this.proposals.delete(key);
    }
    for (const [key, dispatch] of this.dispatches) {
      if (dispatch.session_id === sessionId) this.dispatches.delete(key);
    }
    for (const continuation of this.continuations.values()) {
      if (continuation.envelope.session_id === sessionId) continuation.consumed = true;
    }
    this.emit("session_routing_retired", { session_id: sessionId, reason });
  }

  close() {
    for (const interaction of this.interactions.values()) {
      this.clearTimer(interaction.reminder_timer);
      this.clearTimer(interaction.expiry_timer);
      if (interaction.state === "waiting") {
        interaction.state = "closed";
        interaction.resolve?.({ status: "coordinator_closed" });
      }
    }
  }
}
