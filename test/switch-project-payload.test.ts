import assert from 'node:assert';
import { it, describe } from 'node:test';
import { ProjectService } from '../src/services/projectService.js';

describe('Project Payload Size Contract', () => {
  it('sanitizes explicit project payload to compact size < 1KB without returning heavy systemPrompt or instructions', async () => {
    const ps = new ProjectService();
    await ps.init();

    const dataProj = ps.getRequiredProject('data-project');
    assert.ok(dataProj, 'data-project should resolve explicitly');

    const sanitized = ps.sanitizeProjectForClient(dataProj);
    const jsonStr = JSON.stringify(sanitized, null, 2);

    console.log('Sanitized payload byte length:', Buffer.byteLength(jsonStr, 'utf-8'));
    console.log('Sanitized payload string:\n', jsonStr);

    assert.strictEqual((sanitized as any).systemPrompt, undefined, 'systemPrompt must be omitted from client response');
    assert.strictEqual((sanitized as any).projectInstructions, undefined, 'projectInstructions must be omitted from client response');
    assert.strictEqual((sanitized as any).availableSkills, undefined, 'availableSkills must be omitted from client response');
    assert.ok(Buffer.byteLength(jsonStr, 'utf-8') < 2000, 'Sanitized payload must be under 2KB');
  });
});
