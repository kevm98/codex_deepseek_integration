from __future__ import annotations

from typing import Any

from litellm.integrations.custom_logger import CustomLogger


def _strip_non_function_tools(payload: Any) -> Any:
    if isinstance(payload, list):
        for item in payload:
            _strip_non_function_tools(item)
        return payload

    if not isinstance(payload, dict):
        return payload

    tools = payload.get("tools")
    if isinstance(tools, list):
        function_tools = []
        removed_any = False

        for tool in tools:
            if isinstance(tool, dict) and tool.get("type") == "function":
                _strip_non_function_tools(tool)
                function_tools.append(tool)
            else:
                removed_any = True

        if function_tools:
            payload["tools"] = function_tools
        else:
            payload.pop("tools", None)
            payload.pop("tool_choice", None)
            payload.pop("parallel_tool_calls", None)

        tool_choice = payload.get("tool_choice")
        if removed_any and isinstance(tool_choice, dict):
            if tool_choice.get("type") != "function":
                payload.pop("tool_choice", None)

    for value in list(payload.values()):
        _strip_non_function_tools(value)

    return payload


class CodexDeepSeekToolFilter(CustomLogger):
    async def async_pre_call_hook(
        self, user_api_key_dict, cache, data: dict, call_type
    ):
        return _strip_non_function_tools(data)

    async def async_pre_call_deployment_hook(self, kwargs: dict, call_type):
        return _strip_non_function_tools(kwargs)

    async def async_pre_request_hook(self, model: str, messages: list, kwargs: dict):
        return _strip_non_function_tools(kwargs)


proxy_handler_instance = CodexDeepSeekToolFilter()
