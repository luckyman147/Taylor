from app.services.tool_execution import (
    needs_confirmation,
    set_tool_confirmation_mode,
)

def test_write_tool_needs_confirmation_in_write_only_mode():
    set_tool_confirmation_mode("write_only")
    assert needs_confirmation("create_application", is_write=True) is True

def test_read_tool_skips_confirmation_in_write_only_mode():
    set_tool_confirmation_mode("write_only")
    assert needs_confirmation("get_career_summary", is_write=False) is False

def test_all_mode_blocks_reads():
    set_tool_confirmation_mode("all")
    assert needs_confirmation("get_career_summary", is_write=False) is True

def test_none_mode_allows_writes():
    set_tool_confirmation_mode("none")
    assert needs_confirmation("create_application", is_write=True) is False
