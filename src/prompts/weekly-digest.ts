import { Prompt, PromptArgument, PromptMessage } from '../core/types.js';

/**
 * Hint-style prompt: orchestrates volume + CSAT + theme analysis into
 * a manager-readable weekly digest. Defaults to 7 days.
 */
export class WeeklySupportDigestPrompt implements Prompt {
  public readonly name = 'weekly_support_digest';
  public readonly description =
    'Generate a scannable support-health digest for the last N days (default 7). Combines ticket volume, CSAT, and recurring themes into a 60-second read for managers.';

  public readonly arguments: PromptArgument[] = [
    {
      name: 'window_days',
      description: 'Number of days to cover. Defaults to 7. Keep <=30 for tight digests.',
      required: false,
    },
  ];

  render(args: Record<string, string>): PromptMessage[] {
    const windowDays = args.window_days ?? '7';
    const text = `Generate a support-health digest for the last ${windowDays} days.

Useful angles to combine:
- **Volume**: \`zd_tickets_count_by\` grouped by status and priority, with created_after = today minus ${windowDays} days. Surface anything skewed (e.g. unusual urgent count, hold-pile growing).
- **Quality**: \`zd_satisfaction_summary\` for the same window. Pct positive, response rate, top reasons. Compare to typical baseline if you have prior context.
- **Themes**: \`zd_ticket_search\` with \`created>=\` filter, sample ~20 recent tickets, and identify the top 3-5 recurring topics (look at subject + first message). Names like "SSO setup issues" or "API rate-limit confusion" are more useful than vague tags.
- **Hotspots** (optional): if any specific organization or tag dominates volume, call it out by name.

Lead with what changed or is concerning. If CSAT dropped, urgent volume spiked, or one theme dominates, those go at the top. Don't bury signal under sections.

Output format: scannable headers, short bullets, no walls of text. A manager should be able to read it in 60 seconds.

If a tool is unavailable or returns \`too_broad\`, narrow the parameters and continue — don't bail on the whole digest.`;

    return [{ role: 'user', content: { type: 'text', text } }];
  }
}
