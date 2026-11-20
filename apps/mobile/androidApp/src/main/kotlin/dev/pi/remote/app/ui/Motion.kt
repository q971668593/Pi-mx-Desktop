package dev.pi.remote.app.ui

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing

/**
 * 统一的动效参数：界面里所有淡入/滑入/展开都用这组数字，避免这里 120ms、那里 300ms 的杂乱观感。
 * 与桌面端的 `--motion-fast / --motion-normal` 对齐。
 */
object Motion {
    const val fast = 120
    const val normal = 180
    const val slow = 240

    /** 进场：快出慢入，收尾不拖泥带水。 */
    val enter: Easing = CubicBezierEasing(0.2f, 0f, 0f, 1f)
    /** 弹性：选中、勾选这类小反馈。 */
    val springy: Easing = CubicBezierEasing(0.34f, 1.56f, 0.64f, 1f)
}
