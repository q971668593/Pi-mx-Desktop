package dev.pi.remote.app.data

import android.content.Context
import android.media.RingtoneManager
import android.os.Build
import androidx.core.content.ContextCompat
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * 手机端声音提醒：任务在后台跑完、或需要你回答时响一声。
 *
 * 用系统默认通知铃声（`TYPE_NOTIFICATION`）而不是自带音频：跟着系统静音/音量走，
 * 不额外占包体，也不会盖过用户自己的铃声设置。是否提醒由设置里的开关决定。
 */
class SoundAlerts(private val context: Context) {
    private val prefs = context.getSharedPreferences("ui", Context.MODE_PRIVATE)

    private val _enabled = MutableStateFlow(prefs.getBoolean(KEY, true))
    /** 默认开：后台等结果的时候，声音比横幅更不容易错过。 */
    val enabled: StateFlow<Boolean> = _enabled

    fun setEnabled(value: Boolean) {
        _enabled.value = value
        prefs.edit().putBoolean(KEY, value).apply()
    }

    fun play() {
        if (!_enabled.value) return
        runCatching {
            val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION) ?: return
            val ringtone = RingtoneManager.getRingtone(context, uri) ?: return
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) ringtone.isLooping = false
            ringtone.play()
        }
    }

    private companion object {
        const val KEY = "soundAlerts"
    }
}
