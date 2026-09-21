import json
import io
import os
import platform
import sys
import threading
import time
from importlib.metadata import PackageNotFoundError, version


# Electron writes UTF-8 to stdin. Windows otherwise decodes redirected Python
# stdio with the active ANSI code page, which corrupts Chinese before sending.
if hasattr(sys.stdin, "reconfigure"):
    sys.stdin.reconfigure(encoding="utf-8", errors="strict")
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


def respond(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def package_version(name, fallback="unknown"):
    try:
        return version(name)
    except PackageNotFoundError:
        return fallback


def response_succeeded(result):
    return isinstance(result, dict) and result.get("status") == "成功"


def response_confirmation_pending(result):
    """The UI send action completed, but WeChat's local DB has not caught up yet.

    This state must not be retried automatically: doing so can duplicate a message
    that is already visible to the recipient.
    """
    if not isinstance(result, dict):
        return False
    message = str(result.get("message", ""))
    return "已操作发送" in message and "数据库未确认" in message


def copy_image_pixels_to_clipboard(file_path):
    """Copy decoded image pixels as CF_DIB instead of a file-drop attachment."""
    import win32clipboard
    import win32con
    from PIL import Image

    with Image.open(file_path) as source:
        source.load()
        image = source.convert("RGBA")
        if image.width * image.height > 25_000_000:
            image.thumbnail((5000, 5000), Image.Resampling.LANCZOS)
        background = Image.new("RGB", image.size, "white")
        background.paste(image, mask=image.getchannel("A"))
        png_output = io.BytesIO()
        image.save(png_output, format="PNG")
        output = io.BytesIO()
        background.save(output, format="BMP")
        dib = output.getvalue()[14:]
        png = png_output.getvalue()

    for attempt in range(5):
        try:
            win32clipboard.OpenClipboard()
            try:
                win32clipboard.EmptyClipboard()
                win32clipboard.SetClipboardData(win32con.CF_DIB, dib)
                png_format = win32clipboard.RegisterClipboardFormat("PNG")
                win32clipboard.SetClipboardData(png_format, png)
            finally:
                win32clipboard.CloseClipboard()
            return True
        except Exception:
            if attempt == 4:
                return False
            time.sleep(0.2)
    return False


def send_image_checked(gui, file_path, target):
    """Copy image pixels, paste them into the chat box, then press Enter."""
    from wechatauto.param import WxResponse
    from wechatauto.guia import VK_A, VK_DELETE, VK_RETURN, VK_V

    if not gui.ensure_visible():
        return WxResponse.failure("微信窗口不可见（可能锁屏或会话断开）")
    if target and not (target == getattr(gui, "_current_chat", None) and gui.get_input_box()):
        if not gui._open_chat_and_settle(target):
            return WxResponse.failure(f"无法打开会话：{target}")
        gui._current_chat = target
    box = gui.get_input_box()
    if not box or not gui.focus_input(box):
        return WxResponse.failure("未能聚焦微信聊天输入框")

    # Clear a stale draft first, then put the actual bitmap on the clipboard.
    gui._input.key(VK_A, ctrl=True)
    gui._input.key(VK_DELETE)
    if not copy_image_pixels_to_clipboard(file_path):
        return WxResponse.failure("复制图片到 Windows 剪贴板失败")

    before_seq = gui._target_seq(target)
    gui._input.key(VK_V, ctrl=True)
    draft_detected = gui._input_box_has_color_draft(box, wait=8.0)
    if not draft_detected:
        # Some WeChat 4.1 builds ignore CF_DIB/PNG but accept a copied image file.
        # Keep the user-visible operation identical: copy, Ctrl+V, then Enter.
        gui._input.key(VK_A, ctrl=True)
        gui._input.key(VK_DELETE)
        if not gui.copy_files_to_clipboard([file_path]):
            return WxResponse.failure("图片位图粘贴失败，备用文件剪贴板也不可用")
        gui._input.key(VK_V, ctrl=True)
        draft_detected = gui._input_box_has_color_draft(box, wait=8.0)

    # Give WeChat time to finish decoding the clipboard bitmap before Enter.
    time.sleep(1.5)
    gui._input.key(VK_RETURN)
    time.sleep(2.0)
    if gui._input_box_has_color_draft(box, wait=0.8):
        # Enter adds a newline when WeChat is configured for Ctrl+Enter sending.
        # The same draft is still present, so changing shortcut cannot duplicate it.
        gui._input.key(VK_RETURN, ctrl=True)
        time.sleep(2.0)
    if gui._input_box_has_color_draft(box, wait=0.8):
        # WeChat's universal send shortcut. WinInput has no Alt option, so emit
        # the modifier explicitly around S.
        gui._input._raw_key(0x12, down=True)   # VK_MENU / Alt
        gui._input._raw_key(0x53, down=True)   # S
        gui._input._raw_key(0x53, down=False)
        gui._input._raw_key(0x12, down=False)
        time.sleep(2.0)
    if gui._input_box_has_color_draft(box, wait=0.8):
        # Last UI fallback: click the calibrated center of the send-button area.
        x0, y0, x1, y1 = gui.send_button_region
        gui.wx_click(gui.origin_x + (x0 + x1) // 2, gui.origin_y + (y0 + y1) // 2)
        time.sleep(2.0)

    if gui._verify_attachment_sent(file_path, target, before_seq):
        return WxResponse.success("图片已发送并从聊天记录回读确认", data={"path": file_path})

    box = gui.get_input_box()
    if box and gui._input_box_has_color_draft(box, wait=0.8):
        return WxResponse.failure("图片仍停留在输入框，Enter、Ctrl+Enter、Alt+S 和发送按钮均未触发发送", data={"path": file_path})
    if not draft_detected:
        return WxResponse.failure("已执行图片复制、Ctrl+V 和 Enter，但未检测到图片草稿或聊天记录；请保持微信窗口可见", data={"path": file_path})
    return WxResponse.failure("图片粘贴并按 Enter 后仍未从聊天记录回读确认；为避免重复发送，本次不会自动重试", data={"path": file_path})


def activate_wechat_accessibility():
    """Materialize WeChat 4.1's hidden UIA tree without restarting the client."""
    try:
        from wechatauto.uia_driver import WeChatUIA

        engine = WeChatUIA()
        if not engine.ensure_materialized(timeout=8.0):
            raise RuntimeError("兼容引擎未能激活微信无障碍控件树")
        return package_version("wechatauto-replica")
    except Exception as error:
        raise RuntimeError(f"微信 4.1 兼容引擎启动失败：{error}") from error


def main():
    raw = sys.stdin.readline()
    if not raw:
        respond({"success": False, "message": "没有收到请求"})
        return

    try:
        request = json.loads(raw)
    except Exception:
        respond({"success": False, "message": "请求格式无效"})
        return

    provider = ""
    provider_module = None
    import_error = None
    try:
        import wxauto4 as provider_module
        from wxauto4 import WeChat, WxParam
        provider = "wxauto4"
    except Exception as error:
        import_error = error
        try:
            import wxautox4 as provider_module
            from wxautox4 import WeChat, WxParam
            provider = "wxautox4"
        except Exception as error:
            import_error = error
            try:
                import wxauto as provider_module
                from wxauto import WeChat, WxParam
                provider = "wxauto"
            except Exception as error:
                import_error = error

    if provider_module is None:
        respond({
            "success": False,
            "message": "未安装微信自动化库；微信 4.1 建议安装 wxauto4",
            "detail": str(import_error),
        })
        return

    if hasattr(WxParam, "TELEMETRY_ENABLED"):
        WxParam.TELEMETRY_ENABLED = False

    compatibility_version = package_version("wechatauto-replica", "not-installed")
    if compatibility_version != "not-installed":
        # Version 1.2.2.5 references threading during dynamic layout calibration
        # without importing it. Restore recalibration after window layout changes.
        try:
            import wechatauto.guia as compatibility_gui
            compatibility_gui.threading = threading
        except Exception:
            pass

    def connect_wechat():
        try:
            return WeChat(resize=False, ads=False), False
        except Exception as initial_error:
            if compatibility_version == "not-installed":
                raise initial_error
            activate_wechat_accessibility()
            return WeChat(resize=False, ads=False), True

    action = str(request.get("action", "status"))
    if action == "status":
        try:
            provider_version = version(provider)
        except PackageNotFoundError:
            provider_version = str(getattr(provider_module, "__version__", "unknown"))
        try:
            wx, activated = connect_wechat()
            online = wx.IsOnline() if hasattr(wx, "IsOnline") else True
            if not online:
                raise RuntimeError("微信客户端当前不在线")
            respond({
                "success": True,
                "message": f"Python、{provider} 与微信客户端连接正常" + ("（已自动激活兼容层）" if activated else ""),
                "pythonVersion": platform.python_version(),
                "wxautoVersion": f"{provider_version} + compat {compatibility_version}",
                "provider": f"{provider}+wechatauto-replica",
            })
        except Exception as error:
            respond({
                "success": False,
                "message": f"{provider} 已安装，但无法连接当前微信客户端",
                "detail": str(error),
                "pythonVersion": platform.python_version(),
                "wxautoVersion": f"{provider_version} + compat {compatibility_version}",
                "provider": f"{provider}+wechatauto-replica",
            })
        return

    if action == "send_bundle":
        target = str(request.get("target", "")).strip()
        content = str(request.get("content", "")).strip()
        file_path = os.path.abspath(str(request.get("filePath", "")).strip())
        media_kind = str(request.get("mediaKind", "image")).strip()
        if not target or not content or not file_path or not os.path.isfile(file_path):
            respond({"success": False, "message": "目标、回复文字或图片文件无效"})
            return
        text_sent = False
        confirmation_pending = []
        try:
            if compatibility_version != "not-installed":
                activate_wechat_accessibility()
                from wechatauto.guia import WeChatGUI, quick_send

                verified_target = "filehelper" if target in ("文件传输助手", "filehelper") else target
                text_result = quick_send(content, verified_target, verify=True)
                if response_confirmation_pending(text_result):
                    confirmation_pending.append("文字")
                elif not response_succeeded(text_result):
                    raise RuntimeError(f"文字发送后回读验证失败：{text_result}")
                text_sent = True
                media_gui = WeChatGUI()
                media_result = (send_image_checked(media_gui, file_path, verified_target)
                                if media_kind == "image"
                                else media_gui.send_image(file_path, verified_target, verify=True))
                if not response_succeeded(media_result):
                    raise RuntimeError(str(media_result.get("message", media_result)))
                if confirmation_pending:
                    pending_label = "、".join(confirmation_pending)
                    respond({
                        "success": True,
                        "message": f"文字和图片已操作发送；{pending_label}的数据库确认延迟，为避免重复发送已不再重试",
                        "confirmationPending": True,
                    })
                    return
                respond({"success": True, "message": "文字和表情图片已发送" if media_kind == "emoji" else "文字和图片已发送"})
                return

            wx, _ = connect_wechat()
            if not wx.SendMsg(content, who=target):
                raise RuntimeError("文字发送引擎未确认成功")
            text_sent = True
            if not wx.SendFiles(file_path, who=target):
                raise RuntimeError("图片发送引擎未确认成功")
            respond({"success": True, "message": "文字和表情图片已发送" if media_kind == "emoji" else "文字和图片已发送"})
        except Exception as error:
            if text_sent:
                respond({"success": True, "message": "文字已发送，但附带图片发送失败", "detail": str(error), "partial": True})
            else:
                respond({"success": False, "message": "微信文字和图片发送失败", "detail": str(error)})
        return

    if action == "send_media":
        target = str(request.get("target", "")).strip()
        file_path = os.path.abspath(str(request.get("filePath", "")).strip())
        media_kind = str(request.get("mediaKind", "image")).strip()
        if not target or not file_path or not os.path.isfile(file_path):
            respond({"success": False, "message": "目标或图片文件无效"})
            return
        try:
            if compatibility_version != "not-installed":
                activate_wechat_accessibility()
                from wechatauto.guia import WeChatGUI

                verified_target = "filehelper" if target in ("文件传输助手", "filehelper") else target
                media_gui = WeChatGUI()
                result = (send_image_checked(media_gui, file_path, verified_target)
                          if media_kind == "image"
                          else media_gui.send_image(file_path, verified_target, verify=True))
                if not response_succeeded(result):
                    raise RuntimeError(str(result.get("message", result)))
                respond({"success": True, "message": "表情图片已发送" if media_kind == "emoji" else "图片已发送"})
                return

            wx, _ = connect_wechat()
            result = wx.SendFiles(file_path, who=target)
            if not result:
                raise RuntimeError("发送引擎未确认成功")
            respond({"success": True, "message": "表情图片已发送" if media_kind == "emoji" else "图片已发送"})
        except Exception as error:
            respond({"success": False, "message": "微信图片发送失败", "detail": str(error)})
        return

    if action == "send_mention":
        target = str(request.get("target", "")).strip()
        content = str(request.get("content", "")).strip()
        mention_name = str(request.get("mentionName", "")).strip().lstrip("@")
        if not target or not content or not mention_name:
            respond({"success": False, "message": "群聊目标、@成员或回复内容不能为空"})
            return
        try:
            if compatibility_version != "not-installed":
                activate_wechat_accessibility()
                from wechatauto.guia import WeChatGUI

                verified_target = "filehelper" if target in ("文件传输助手", "filehelper") else target
                result = WeChatGUI().at_member(mention_name, content, verified_target, verify=True)
                if response_confirmation_pending(result):
                    respond({
                        "success": True,
                        "message": "@消息已操作发送；数据库确认延迟，为避免重复发送已不再重试",
                        "confirmationPending": True,
                    })
                    return
                if not response_succeeded(result):
                    raise RuntimeError(f"原生@发送后回读验证失败：{result}")
                respond({"success": True, "message": "已原生@指定成员接手回答"})
                return

            wx, _ = connect_wechat()
            try:
                result = wx.SendMsg(content, who=target, at=mention_name)
            except (TypeError, AttributeError):
                raise RuntimeError("当前微信发送引擎不支持原生@成员")
            if not result:
                raise RuntimeError("@消息发送引擎未确认成功")
            respond({"success": True, "message": "已原生@指定成员接手回答"})
        except Exception as error:
            respond({"success": False, "message": "群聊兜底@发送失败", "detail": str(error)})
        return

    if action != "send_text":
        respond({"success": False, "message": "不支持的操作"})
        return

    target = str(request.get("target", "")).strip()
    content = str(request.get("content", "")).strip()
    if not target or not content:
        respond({"success": False, "message": "目标与回复内容不能为空"})
        return

    try:
        if compatibility_version != "not-installed":
            activate_wechat_accessibility()
            from wechatauto.guia import quick_send

            verified_target = "filehelper" if target in ("文件传输助手", "filehelper") else target
            result = quick_send(content, verified_target, verify=True)
            if response_confirmation_pending(result):
                respond({
                    "success": True,
                    "message": "消息已操作发送；数据库确认延迟，为避免重复发送已不再重试",
                    "confirmationPending": True,
                })
                return
            if not response_succeeded(result):
                raise RuntimeError(f"发送后回读验证失败：{result}")
            respond({"success": True, "message": "消息已发送并从聊天记录回读确认"})
            return

        wx, _ = connect_wechat()
        result = wx.SendMsg(content, who=target)
        if not result:
            respond({"success": False, "message": "发送引擎未确认成功，请检查目标名称和微信窗口"})
            return
        respond({"success": True, "message": "消息已交给微信客户端发送（当前引擎不支持回读验证）"})
    except Exception as error:
        respond({"success": False, "message": "微信发送失败", "detail": str(error)})


if __name__ == "__main__":
    main()
