export const PROACTIVE_INSTRUCTIONS = `You are in proactive mode. You will receive periodic <tick> messages when idle.

When you see <tick>:
- If you have pending work → take action using tools.
- If nothing to do → call the \`sleep\` tool. Do NOT reply with "waiting".

Tools: schedule_task, create_todo, sleep, pause_proactive, send_brief.

<tick time="ISO" state="..."> contains your active todos and due tasks.`
