package com.sleeperhq.rozenite.input

import android.app.Instrumentation
import android.graphics.Color
import android.graphics.Rect
import android.graphics.drawable.ColorDrawable
import android.os.Build
import android.os.SystemClock
import android.text.Spanned
import android.text.TextPaint
import android.text.style.CharacterStyle
import android.view.Gravity
import android.view.InputDevice
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.accessibility.AccessibilityNodeInfo
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.TextView
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.BackgroundStyleApplicator
import com.facebook.react.uimanager.style.LogicalEdge
import java.lang.reflect.Method
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Synthetic input for the Input DevTools panel and its agent tools. Registered in debug builds only.
 * Coordinates are React Native points (dp) relative to the app's content view, like `pageX`/`pageY`.
 */
class InputInjector(
    private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

    private val executor = Executors.newSingleThreadExecutor()
    private val instrumentation = Instrumentation()

    override fun getName(): String = "InputInjector"

    override fun invalidate() {
        executor.shutdownNow()
        super.invalidate()
    }

    private val density: Float
        get() = reactContext.resources.displayMetrics.density

    @ReactMethod
    fun tap(x: Double, y: Double, promise: Promise) {
        drag(x, y, x, y, 0, TAP_HOLD_MS, promise)
    }

    @ReactMethod
    fun swipe(fromX: Double, fromY: Double, toX: Double, toY: Double, durationMs: Double, promise: Promise) {
        val steps = max(2, ceil(durationMs / MOVE_STEP_MS).toInt())
        drag(fromX, fromY, toX, toY, steps, MOVE_STEP_MS, promise)
    }

    private fun drag(fromX: Double, fromY: Double, toX: Double, toY: Double, steps: Int, holdMs: Long, promise: Promise) {
        executor.execute {
            try {
                val origin = contentOriginOnScreen()
                fun screenX(x: Double) = origin[0] + (x * density).toFloat()
                fun screenY(y: Double) = origin[1] + (y * density).toFloat()

                val downTime = SystemClock.uptimeMillis()
                inject(downTime, MotionEvent.ACTION_DOWN, screenX(fromX), screenY(fromY))
                Thread.sleep(holdMs)
                for (step in 1..steps) {
                    val progress = step.toDouble() / steps
                    inject(
                        downTime,
                        MotionEvent.ACTION_MOVE,
                        screenX(fromX + (toX - fromX) * progress),
                        screenY(fromY + (toY - fromY) * progress)
                    )
                    Thread.sleep(MOVE_STEP_MS)
                }
                inject(downTime, MotionEvent.ACTION_UP, screenX(toX), screenY(toY))
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("ERR_TOUCH", e.message, e)
            }
        }
    }

    private fun inject(downTime: Long, action: Int, x: Float, y: Float) {
        val event = MotionEvent.obtain(downTime, SystemClock.uptimeMillis(), action, x, y, 0)
        event.source = InputDevice.SOURCE_TOUCHSCREEN
        try {
            instrumentation.sendPointerSync(event)
        } catch (e: SecurityException) {
            throw IllegalStateException("The touch lands on a window the app doesn't own, such as the keyboard")
        } catch (e: Exception) {
            dispatchToActivity(event)
        } finally {
            event.recycle()
        }
    }

    // Reaches the activity window only, not dialogs.
    private fun dispatchToActivity(event: MotionEvent) {
        val decor = reactContext.currentActivity?.window?.decorView ?: throw IllegalStateException("No activity")
        val location = IntArray(2)
        val latch = CountDownLatch(1)
        UiThreadUtil.runOnUiThread {
            try {
                decor.getLocationOnScreen(location)
                val local = MotionEvent.obtain(event)
                local.offsetLocation(-location[0].toFloat(), -location[1].toFloat())
                decor.dispatchTouchEvent(local)
                local.recycle()
            } finally {
                latch.countDown()
            }
        }
        latch.await()
    }

    private fun contentView(): View? = reactContext.currentActivity?.findViewById(android.R.id.content)

    private fun contentOriginOnScreen(): IntArray {
        val location = IntArray(2)
        val latch = CountDownLatch(1)
        UiThreadUtil.runOnUiThread {
            try {
                contentView()?.getLocationOnScreen(location)
            } finally {
                latch.countDown()
            }
        }
        latch.await()
        return location
    }

    private class WindowRoots(private val global: Any, private val getViewRootNames: Method, private val getRootView: Method) {
        fun views(): List<View> = (getViewRootNames.invoke(global) as Array<*>).mapNotNull { getRootView.invoke(global, it) as? View }
    }

    // WindowManagerGlobal is hidden API; it's the only way to reach dialog and popup windows.
    private val windowRoots: WindowRoots? by lazy {
        try {
            val global = Class.forName("android.view.WindowManagerGlobal")
            WindowRoots(
                global.getMethod("getInstance").invoke(null)!!,
                global.getMethod("getViewRootNames"),
                global.getMethod("getRootView", String::class.java)
            )
        } catch (_: Exception) {
            null
        }
    }

    private fun rootViews(): List<View> {
        try {
            val roots = windowRoots?.views()?.filter { it.isShown }
            if (!roots.isNullOrEmpty()) return roots
        } catch (_: Exception) {
        }
        return listOfNotNull(reactContext.currentActivity?.window?.decorView)
    }

    @ReactMethod
    fun elements(promise: Promise) {
        snapshot(false, promise)
    }

    @ReactMethod
    fun elementsAndViews(promise: Promise) {
        snapshot(true, promise)
    }

    /** A hash of the views on screen, for telling whether the screen changed without reading it. */
    @ReactMethod
    fun fingerprint(promise: Promise) {
        UiThreadUtil.runOnUiThread {
            try {
                var hash = 17L
                for (root in rootViews()) hash = fingerprintOf(root, hash)
                promise.resolve(java.lang.Long.toHexString(hash))
            } catch (e: Exception) {
                promise.reject("ERR_FINGERPRINT", e.message, e)
            }
        }
    }

    // Cheap enough to poll: covers frames, scrolling, alpha, transforms and field text, but not text React re-renders.
    private fun fingerprintOf(view: View, seed: Long): Long {
        if (view.visibility != View.VISIBLE || view.alpha < 0.01f) return seed
        var hash = seed
        fun mix(value: Long) {
            hash = hash * 31 + value
        }
        mix(System.identityHashCode(view).toLong())
        mix(view.left.toLong())
        mix(view.top.toLong())
        mix(view.width.toLong())
        mix(view.height.toLong())
        mix(view.scrollX.toLong())
        mix(view.scrollY.toLong())
        mix(view.translationX.toRawBits().toLong())
        mix(view.translationY.toRawBits().toLong())
        mix(view.scaleX.toRawBits().toLong())
        mix(view.scaleY.toRawBits().toLong())
        mix(view.alpha.toRawBits().toLong())
        if (view is EditText) {
            mix(view.text.toString().hashCode().toLong())
        } else if (view is ViewGroup) {
            for (i in 0 until view.childCount) hash = fingerprintOf(view.getChildAt(i), hash)
        }
        mix(0)
        return hash
    }

    private fun snapshot(withViews: Boolean, promise: Promise) {
        UiThreadUtil.runOnUiThread {
            try {
                val content = contentView()
                val origin = IntArray(2)
                content?.getLocationOnScreen(origin)
                val elements = Arguments.createArray()
                val views = Arguments.createArray()
                var elementCount = 0
                var viewCount = 0
                rootViews().forEachIndexed { index, root ->
                    val rootOffset = IntArray(2)
                    root.getLocationOnScreen(rootOffset)
                    rootOffset[0] -= origin[0]
                    rootOffset[1] -= origin[1]
                    elementCount += collectElements(root, index, origin, rootOffset, elements, MAX_ELEMENTS - elementCount)
                    if (withViews) viewCount += collectViews(root, index, origin, rootOffset, views, MAX_VIEWS - viewCount, 1f, null)
                }
                val metrics = reactContext.resources.displayMetrics
                val result = Arguments.createMap()
                result.putArray("elements", elements)
                result.putBoolean("truncated", elementCount >= MAX_ELEMENTS)
                result.putMap("screen", rect(0, 0, content?.width ?: metrics.widthPixels, content?.height ?: metrics.heightPixels))
                if (withViews) {
                    result.putArray("views", views)
                    result.putBoolean("viewsTruncated", viewCount >= MAX_VIEWS)
                }
                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("ERR_ELEMENTS", e.message, e)
            }
        }
    }

    /**
     * What each view draws itself, leaving out wrappers the size of their parent that draw nothing. Siblings are in
     * drawing order on API 29+ only.
     */
    private fun collectViews(
        view: View,
        windowIndex: Int,
        origin: IntArray,
        rootOffset: IntArray,
        into: WritableArray,
        budget: Int,
        parentOpacity: Float,
        parentVisible: Rect?
    ): Int {
        if (budget <= 0 || view.visibility != View.VISIBLE) return 0
        val opacity = parentOpacity * view.alpha
        if (opacity < 0.01f) return 0
        var added = 0
        val visible = Rect()
        val onScreen = view.getGlobalVisibleRect(visible)
        if (onScreen) {
            visible.offset(rootOffset[0], rootOffset[1])
            val box = Arguments.createMap()
            var draws = false
            val background = BackgroundStyleApplicator.getBackgroundColor(view) ?: (view.background as? ColorDrawable)?.color
            hexColor(background, opacity)?.let {
                box.putString("background", it)
                draws = true
            }
            val borderWidth = BackgroundStyleApplicator.getBorderWidth(view, LogicalEdge.ALL)
            val borderColor = hexColor(BackgroundStyleApplicator.getBorderColor(view, LogicalEdge.ALL), opacity)
            if (borderWidth != null && borderWidth > 0 && borderColor != null) {
                val border = Arguments.createMap()
                border.putString("color", borderColor)
                border.putDouble("width", borderWidth.toDouble())
                box.putMap("border", border)
                draws = true
            }
            if (view is TextView && addText(view, box, opacity)) draws = true
            if (draws || visible != parentVisible) {
                box.putMap("frame", rect(visible.left, visible.top, visible.width(), visible.height()))
                val location = IntArray(2)
                view.getLocationOnScreen(location)
                val full = Rect(location[0] - origin[0], location[1] - origin[1], location[0] - origin[0] + view.width, location[1] - origin[1] + view.height)
                if (full != visible) box.putMap("full", rect(full.left, full.top, full.width(), full.height()))
                box.putInt("window", windowIndex)
                into.pushMap(box)
                added += 1
            }
        }
        if (view is ViewGroup) {
            for (i in 0 until view.childCount) {
                val index = if (Build.VERSION.SDK_INT >= 29) view.getChildDrawingOrder(i) else i
                added += collectViews(view.getChildAt(index), windowIndex, origin, rootOffset, into, budget - added, opacity, if (onScreen) visible else parentVisible)
            }
        }
        return added
    }

    /** A text view's text, or a field's hint when it is empty, and how its first character is drawn. */
    private fun addText(view: TextView, box: WritableMap, opacity: Float): Boolean {
        val content = view.text
        val placeholder = content.isNullOrEmpty()
        val text = if (placeholder) (if (view is EditText) view.hint else null) else content
        if (text.isNullOrEmpty()) return false
        val paint = TextPaint(view.paint)
        paint.color = if (placeholder) view.currentHintTextColor else view.currentTextColor
        if (!placeholder && text is Spanned) {
            text.getSpans(0, 1, CharacterStyle::class.java).forEach { it.updateDrawState(paint) }
        }
        val string = text.toString()
        val end = if (string.length > MAX_VIEW_TEXT && Character.isHighSurrogate(string[MAX_VIEW_TEXT - 1])) MAX_VIEW_TEXT - 1 else MAX_VIEW_TEXT
        box.putString("text", string.take(end))
        if (placeholder) box.putBoolean("placeholder", true)
        val style = Arguments.createMap()
        style.putDouble("size", halfPoints(paint.textSize))
        val typeface = paint.typeface
        val base = when {
            typeface != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P -> typeface.weight
            typeface?.isBold == true -> 700
            else -> 400
        }
        style.putInt("weight", if (paint.isFakeBoldText) max(base, 700) else base)
        if (typeface?.isItalic == true || paint.textSkewX != 0f) style.putBoolean("italic", true)
        hexColor(paint.color, opacity)?.let { style.putString("color", it) }
        when (view.gravity and Gravity.HORIZONTAL_GRAVITY_MASK) {
            Gravity.CENTER_HORIZONTAL -> style.putString("align", "center")
            Gravity.RIGHT -> style.putString("align", "right")
        }
        box.putMap("style", style)
        return true
    }

    /** `#RRGGBBAA`, with `opacity` from the views around it; null for no color or a clear one. */
    private fun hexColor(color: Int?, opacity: Float): String? {
        if (color == null) return null
        val alpha = (Color.alpha(color) * opacity).roundToInt()
        if (alpha < 3) return null
        return String.format("#%02X%02X%02X%02X", Color.red(color), Color.green(color), Color.blue(color), alpha)
    }

    private fun collectElements(view: View, windowIndex: Int, origin: IntArray, rootOffset: IntArray, into: WritableArray, budget: Int): Int {
        if (budget <= 0 || view.visibility != View.VISIBLE || view.alpha < 0.01f) return 0
        var added = 0
        val visible = Rect()
        if (view.getGlobalVisibleRect(visible)) {
            val testID = view.getTag(com.facebook.react.R.id.react_test_id) as? String
            val info = AccessibilityNodeInfo.obtain()
            view.onInitializeAccessibilityNodeInfo(info)
            val label = (if (view is EditText) info.contentDescription ?: view.hint else info.contentDescription ?: info.text)?.toString()
            val value = if (view is EditText) view.text?.toString() else null
            if (!testID.isNullOrEmpty() || !label.isNullOrEmpty() || !value.isNullOrEmpty() || info.isClickable) {
                val location = IntArray(2)
                view.getLocationOnScreen(location)
                val element = Arguments.createMap()
                element.putMap("frame", rect(location[0] - origin[0], location[1] - origin[1], view.width, view.height))
                val center = Arguments.createMap()
                center.putDouble("x", ((visible.exactCenterX() + rootOffset[0]) / density).roundToInt().toDouble())
                center.putDouble("y", ((visible.exactCenterY() + rootOffset[1]) / density).roundToInt().toDouble())
                element.putMap("center", center)
                val traits = Arguments.createArray()
                if (info.isClickable) traits.pushString("button")
                if (info.isSelected) traits.pushString("selected")
                if (!info.isEnabled) traits.pushString("disabled")
                if (info.isEditable) traits.pushString("editable")
                element.putArray("traits", traits)
                element.putInt("window", windowIndex)
                element.putString("type", view.javaClass.simpleName)
                if (!testID.isNullOrEmpty()) element.putString("testID", testID)
                if (!label.isNullOrEmpty()) element.putString("label", label)
                if (!value.isNullOrEmpty()) element.putString("value", value)
                into.pushMap(element)
                added += 1
            }
            @Suppress("DEPRECATION")
            info.recycle()
        }
        if (view is ViewGroup) {
            for (i in 0 until view.childCount) {
                added += collectElements(view.getChildAt(i), windowIndex, origin, rootOffset, into, budget - added)
            }
        }
        return added
    }

    private fun halfPoints(px: Float): Double = ((px / density) * 2).roundToInt() / 2.0

    private fun rect(left: Int, top: Int, width: Int, height: Int): WritableMap {
        val map = Arguments.createMap()
        map.putDouble("x", halfPoints(left.toFloat()))
        map.putDouble("y", halfPoints(top.toFloat()))
        map.putDouble("width", halfPoints(width.toFloat()))
        map.putDouble("height", halfPoints(height.toFloat()))
        return map
    }

    /** Runs `edit` on the focused text field, or rejects with why there isn't one. */
    private fun withFocusedField(promise: Promise, edit: (EditText) -> Unit) {
        UiThreadUtil.runOnUiThread {
            val focused = rootViews().asReversed().firstNotNullOfOrNull { it.findFocus() }
            when (focused) {
                null -> promise.reject("ERR_NO_FOCUS", "No text field is focused; tap one first")
                !is EditText -> promise.reject("ERR_NOT_TEXT", "Focused view ${focused.javaClass.simpleName} does not take text")
                else -> try {
                    edit(focused)
                    val result = Arguments.createMap()
                    result.putString("view", focused.javaClass.simpleName)
                    promise.resolve(result)
                } catch (e: Exception) {
                    promise.reject("ERR_TYPE", e.message, e)
                }
            }
        }
    }

    /** "\n" in a single-line field is the return key: it runs the field's keyboard action, as the keyboard's does. */
    @ReactMethod
    fun typeText(text: String, promise: Promise) {
        withFocusedField(promise) { field ->
            if (text == "\n" && field.maxLines <= 1) {
                field.onEditorAction(field.imeOptions and EditorInfo.IME_MASK_ACTION)
            } else {
                val start = max(0, minOf(field.selectionStart, field.selectionEnd))
                val end = max(0, maxOf(field.selectionStart, field.selectionEnd))
                field.text.replace(start, end, text)
            }
        }
    }

    /** The keyboard's delete key, `count` times: a selection goes first, then the characters before the cursor. */
    @ReactMethod
    fun deleteBackward(count: Double, promise: Promise) {
        withFocusedField(promise) { field ->
            var remaining = max(1, count.toInt())
            val start = max(0, minOf(field.selectionStart, field.selectionEnd))
            val end = max(0, maxOf(field.selectionStart, field.selectionEnd))
            if (end > start) {
                field.text.delete(start, end)
                remaining -= 1
            }
            if (remaining > 0 && start > 0) field.text.delete(max(0, start - remaining), start)
        }
    }

    companion object {
        private const val TAP_HOLD_MS = 60L
        private const val MOVE_STEP_MS = 16L
        private const val MAX_ELEMENTS = 600
        private const val MAX_VIEWS = 1500
        private const val MAX_VIEW_TEXT = 500
    }
}
