import type { Message } from '@xsai/shared-chat'

import { describe, expect, it } from 'vitest'

import { fromChat, fromResponses, toChat, toResponses } from '../../src/index'

describe('input conversion', () => {
  it('converts Responses content to Chat content', () => {
    expect(toChat([{
      content: [
        { text: 'hello', type: 'input_text' },
        { detail: 'high', image_url: 'https://example.com/image.png', type: 'input_image' },
      ],
      role: 'user',
      type: 'message',
    }])).toEqual([{
      content: [
        { text: 'hello', type: 'text' },
        {
          image_url: { detail: 'high', url: 'https://example.com/image.png' },
          type: 'image_url',
        },
      ],
      role: 'user',
    }])
  })

  it('converts Chat messages to agent input', () => {
    const messages: Message[] = [
      {
        content: 'calling tool',
        reasoning_content: 'reasoning',
        role: 'assistant',
        tool_calls: [{
          function: { arguments: '{"value":1}', name: 'test' },
          id: 'call-1',
          type: 'function',
        }],
      },
      {
        content: [{ text: 'done', type: 'text' }],
        role: 'tool',
        tool_call_id: 'call-1',
      },
    ]

    expect(fromChat(messages)).toEqual([
      {
        content: 'calling tool',
        reasoning: undefined,
        reasoning_content: 'reasoning',
        refusal: undefined,
        role: 'assistant',
        tool_calls: messages[0]?.role === 'assistant' ? messages[0].tool_calls : undefined,
        type: 'message',
      },
      {
        call_id: 'call-1',
        output: [{ text: 'done', type: 'input_text' }],
        type: 'function_call_output',
      },
    ])
  })

  it('expands Chat tool calls without mutating input', () => {
    const [input] = fromChat([{
      content: 'calling tool',
      role: 'assistant',
      tool_calls: [{
        function: { arguments: '{}', name: 'test' },
        id: 'call-1',
        type: 'function',
      }],
    }])

    expect(toResponses([input])).toEqual([
      {
        content: 'calling tool',
        role: 'assistant',
        type: 'message',
      },
      {
        arguments: '{}',
        call_id: 'call-1',
        name: 'test',
        type: 'function_call',
      },
    ])
    expect(input).toHaveProperty('tool_calls')
  })

  it('uses Responses items as agent input', () => {
    const item = { content: 'hello', role: 'user', type: 'message' } as const
    const [input] = fromResponses([item])

    expect(input).toEqual(item)
    expect(input).toBe(item)
  })

  it('skips Responses video content when converting to Chat', () => {
    expect(toChat([{
      call_id: 'call-1',
      output: [
        { type: 'input_video', video_url: 'https://example.com/video.mp4' },
        { text: 'done', type: 'input_text' },
      ],
      type: 'function_call_output',
    }])).toEqual([{
      content: [{ text: 'done', type: 'text' }],
      role: 'tool',
      tool_call_id: 'call-1',
    }])
  })

  it('skips Chat audio content when converting to Responses', () => {
    expect(fromChat([{
      content: [
        {
          input_audio: { data: 'base64', format: 'mp3' },
          type: 'input_audio',
        },
        { text: 'hello', type: 'text' },
      ],
      role: 'user',
    }])).toEqual([{
      content: [{ text: 'hello', type: 'input_text' }],
      role: 'user',
      type: 'message',
    }])
  })
})
