#!/bin/bash
# Mock claude that outputs realistic stream-json
# Usage: mock-claude.sh -p <prompt> [--verbose] [--output-format stream-json]

# Output mock stream-json events
echo '{"type":"message","message":{"id":"msg_mock","model":"claude-sonnet-4-6","usage":{"input_tokens":5000,"output_tokens":0,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}'
echo '{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}'
echo '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"I completed the task successfully."}}'
echo '{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tool_01","name":"Read","input":{}}}'
echo '{"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"tool_02","name":"Write","input":{}}}'
echo '{"type":"message","message":{"id":"msg_mock","model":"claude-sonnet-4-6","usage":{"input_tokens":0,"output_tokens":1500,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}'

exit 0
