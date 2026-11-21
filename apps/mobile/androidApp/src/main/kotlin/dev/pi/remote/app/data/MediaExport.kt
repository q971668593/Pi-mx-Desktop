package dev.pi.remote.app.data

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream

/** 把图片存到相册 / 分享出去：手机上最常用的两个动作，不要求额外权限（Android 10+）。 */
object MediaExport {
    /** 写入相册（Pictures/Pi mx），返回可读的 content:// 地址。 */
    fun saveToGallery(context: Context, bitmap: Bitmap, name: String): Uri? = runCatching {
        val safe = name.replace(Regex("[\\/:*?\"<>|]"), "_").ifEmpty { "pi-image.png" }
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, safe)
            put(MediaStore.Images.Media.MIME_TYPE, "image/png")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                put(MediaStore.Images.Media.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/Pi mx")
                put(MediaStore.Images.Media.IS_PENDING, 1)
            }
        }
        val resolver = context.contentResolver
        val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: return null
        resolver.openOutputStream(uri)?.use { out -> bitmap.compress(Bitmap.CompressFormat.PNG, 100, out) }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            values.clear()
            values.put(MediaStore.Images.Media.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
        }
        uri
    }.getOrNull()

    /** 分享：先落到 cache/shared，再交给系统的分享面板。 */
    fun shareBitmap(context: Context, bitmap: Bitmap, name: String) {
        runCatching {
            val dir = File(context.cacheDir, "shared").apply { mkdirs() }
            val safe = name.replace(Regex("[\\/:*?\"<>|]"), "_").ifEmpty { "pi-image.png" }
            val file = File(dir, safe)
            FileOutputStream(file).use { out -> bitmap.compress(Bitmap.CompressFormat.PNG, 100, out) }
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
            val intent = Intent(Intent.ACTION_SEND).apply {
                type = "image/png"
                putExtra(Intent.EXTRA_STREAM, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            context.startActivity(Intent.createChooser(intent, null))
        }
    }
}
