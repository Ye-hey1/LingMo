import type { SkillContent } from '@/lib/skills/types'

export function buildWriterSkillInstruction(skill: SkillContent, userRequest: string) {
  return [
    `# Skill: ${skill.metadata.name}`,
    '',
    'The user explicitly invoked this writing/advisory Skill.',
    'Produce the final user-visible content directly.',
    'Do not use ReAct JSON, tool calls, Action, Observation, or final_answer wrappers.',
    'Do not mention this wrapper.',
    '',
    '## Skill Instructions',
    skill.instructions,
    '',
    '## User Request',
    userRequest,
  ].join('\n')
}

export async function runWriterSkill<T>(params: {
  skill: SkillContent
  userRequest: string
  run: (instruction: string) => Promise<T>
}): Promise<T> {
  return params.run(buildWriterSkillInstruction(params.skill, params.userRequest))
}
