/** A normal Cordis plugin No browser-specific SDK is required. */
export const name = 'community-hello'
export const inject = ['tools']
/** Contribute a tool through the ordinary registry and release it when disabled.
 * @param {import('@deepseek-ai/cordis').Context} ctx Owning plugin context
 */
export function apply(ctx) {
  ctx.effect(() => ctx.tools.register({
    name: 'community_echo',
    description: 'Echo text through a community Cordis plugin',
    parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
    output: {
      schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    execute: async args => ({ text: 'Cordis ' + args.text }),
  }), 'community-hello tool')
}
