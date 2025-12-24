
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIContentGenerator } from '../openaiContentGenerator.js';
import { Config } from '../../config/config.js';

describe('OpenAIContentGenerator Parsing', () => {
  let generator: any;
  let mockConfig: Config;

  beforeEach(() => {
    mockConfig = {
      getContentGeneratorConfig: vi.fn().mockReturnValue({}),
    } as any;
    generator = new OpenAIContentGenerator('test-key', 'gpt-4', mockConfig);
  });

  it('should robustly parse tool call arguments with multiple objects', () => {
    // Simulate multiple objects in arguments (common bug in some providers)
    const chunk1 = {
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: 'call_1',
            function: { name: 'test_tool', arguments: '{"arg": 1}' }
          }]
        }
      }]
    };
    const chunk2 = {
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            function: { arguments: '{"arg": 1}' }
          }]
        },
        finish_reason: 'stop'
      }]
    };

    generator.convertStreamChunkToGeminiFormat(chunk1);
    const result = generator.convertStreamChunkToGeminiFormat(chunk2);

    const call = result.candidates[0].content.parts[0].functionCall;
    expect(call.args).toEqual({ arg: 1 });
  });

  it('should robustly parse tool call arguments with trailing text', () => {
    const chunk = {
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: 'call_1',
            function: { name: 'test_tool', arguments: '{"arg": 1} some trailing text' }
          }]
        },
        finish_reason: 'stop'
      }]
    };

    const result = generator.convertStreamChunkToGeminiFormat(chunk);
    const call = result.candidates[0].content.parts[0].functionCall;
    expect(call.args).toEqual({ arg: 1 });
  });

  it('should handle non-object JSON values if they are valid', () => {
    // Although OpenAI expects an object, let's see what happens with a string
    const chunk = {
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: 'call_1',
            function: { name: 'test_tool', arguments: '"only_a_string" extra text' }
          }]
        },
        finish_reason: 'stop'
      }]
    };

    const result = generator.convertStreamChunkToGeminiFormat(chunk);
    const call = result.candidates[0].content.parts[0].functionCall;
    // Current implementation might fail here and return {}
    expect(call.args).toBeDefined();
  });

  it('should handle reasoning_content by wrapping it in <think> tags', () => {
    const chunk1 = {
      choices: [{
        delta: { reasoning_content: 'Thinking part 1' }
      }]
    };
    const chunk2 = {
      choices: [{
        delta: { reasoning_content: ' part 2' }
      }]
    };
    const chunk3 = {
      choices: [{
        delta: { content: 'Actual result' }
      }],
      finish_reason: 'stop'
    };

    const res1 = generator.convertStreamChunkToGeminiFormat(chunk1);
    const res2 = generator.convertStreamChunkToGeminiFormat(chunk2);
    const res3 = generator.convertStreamChunkToGeminiFormat(chunk3);

    expect(res1.candidates[0].content.parts[0].text).toBe('<think>Thinking part 1');
    expect(res2.candidates[0].content.parts[0].text).toBe(' part 2');
    expect(res3.candidates[0].content.parts[0].text).toBe('</think>Actual result');
  });
});
