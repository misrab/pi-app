// Translates the browser's pi-RPC JSON commands into SDK calls on a session,
// producing protocol-identical responses. Ported from pi's own rpc-mode
// handleCommand so the existing frontend works unchanged. Events are delivered
// separately (manager fan-out); this only handles command -> response.

type Respond = (obj: unknown) => void;

const ok = (id: string | undefined, command: string, data?: unknown) =>
  data === undefined
    ? { id, type: "response", command, success: true }
    : { id, type: "response", command, success: true, data };

const fail = (id: string | undefined, command: string, error: string) => ({
  id,
  type: "response",
  command,
  success: false,
  error,
});

/**
 * Handle one command. Most return a response synchronously; `prompt` is special
 * (its acceptance is reported via preflight, then it streams), so it sends its
 * own response through `respond` and returns undefined.
 */
export async function handleCommand(
  session: any,
  command: any,
  respond: Respond,
): Promise<object | undefined> {
  const id = command?.id as string | undefined;

  switch (command?.type) {
    case "prompt": {
      let preflightOk = false;
      void session
        .prompt(command.message, {
          images: command.images,
          streamingBehavior: command.streamingBehavior,
          source: "rpc",
          preflightResult: (didSucceed: boolean) => {
            if (didSucceed) {
              preflightOk = true;
              respond(ok(id, "prompt"));
            }
          },
        })
        .catch((e: any) => {
          if (!preflightOk) respond(fail(id, "prompt", msg(e)));
        });
      return undefined;
    }

    case "steer":
      await session.steer(command.message, command.images);
      return ok(id, "steer");

    case "follow_up":
      await session.followUp(command.message, command.images);
      return ok(id, "follow_up");

    case "abort":
      await session.abort();
      return ok(id, "abort");

    case "get_state":
      return ok(id, "get_state", {
        model: session.model,
        thinkingLevel: session.thinkingLevel,
        isStreaming: session.isStreaming,
        isCompacting: session.isCompacting,
        steeringMode: session.steeringMode,
        followUpMode: session.followUpMode,
        sessionFile: session.sessionFile,
        sessionId: session.sessionId,
        sessionName: session.sessionName,
        autoCompactionEnabled: session.autoCompactionEnabled,
        messageCount: session.messages.length,
        pendingMessageCount: session.pendingMessageCount,
      });

    case "set_model": {
      const models = await session.modelRegistry.getAvailable();
      const model = models.find(
        (m: any) => m.provider === command.provider && m.id === command.modelId,
      );
      if (!model) return fail(id, "set_model", `Model not found: ${command.provider}/${command.modelId}`);
      await session.setModel(model);
      return ok(id, "set_model", model);
    }

    case "cycle_model": {
      const result = await session.cycleModel();
      return ok(id, "cycle_model", result ?? null);
    }

    case "get_available_models": {
      const models = await session.modelRegistry.getAvailable();
      return ok(id, "get_available_models", { models });
    }

    case "set_thinking_level":
      session.setThinkingLevel(command.level);
      return ok(id, "set_thinking_level");

    case "cycle_thinking_level": {
      const level = session.cycleThinkingLevel();
      return ok(id, "cycle_thinking_level", level ? { level } : null);
    }

    case "compact": {
      const result = await session.compact(command.customInstructions);
      return ok(id, "compact", result);
    }

    case "set_auto_compaction":
      session.setAutoCompactionEnabled(command.enabled);
      return ok(id, "set_auto_compaction");

    case "get_session_stats":
      return ok(id, "get_session_stats", session.getSessionStats());

    case "set_session_name": {
      const name = String(command.name ?? "").trim();
      if (!name) return fail(id, "set_session_name", "Session name cannot be empty");
      session.setSessionName(name);
      return ok(id, "set_session_name");
    }

    case "get_messages":
      return ok(id, "get_messages", { messages: session.messages });

    case "run_command": {
      const name = String(command.name ?? "").trim();
      const args = String(command.args ?? "").trim();
      const cmd = session.extensionRunner?.getCommand(name);
      if (!cmd) return fail(id, "run_command", `Unknown command: ${name}`);
      const ctx = session.extensionRunner.createCommandContext();
      await cmd.handler(args, ctx);
      return ok(id, "run_command");
    }

    case "get_commands":
      return ok(id, "get_commands", { commands: collectCommands(session) });

    default:
      return fail(id, String(command?.type ?? "unknown"), `Unknown command: ${command?.type}`);
  }
}

function collectCommands(session: any): any[] {
  const commands: any[] = [];
  try {
    for (const c of session.extensionRunner.getRegisteredCommands()) {
      commands.push({ name: c.invocationName, description: c.description, source: "extension" });
    }
    for (const t of session.promptTemplates) {
      commands.push({ name: t.name, description: t.description, source: "prompt" });
    }
    for (const s of session.resourceLoader.getSkills().skills) {
      commands.push({ name: `skill:${s.name}`, description: s.description, source: "skill" });
    }
  } catch {
    /* best-effort */
  }
  return commands;
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
