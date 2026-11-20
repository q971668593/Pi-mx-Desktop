package dev.pi.remote.app

import dev.pi.remote.app.ui.session.ImagePaths
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ImagePathsTest {
    @Test
    fun findsProjectImagePathsInToolOutput() {
        val text = "saved to generated-images/poster-2026.png (1024x1536)\nand generated-images/alt.webp"
        assertEquals(listOf("generated-images/poster-2026.png", "generated-images/alt.webp"), ImagePaths.find(text))
    }

    @Test
    fun keepsAbsoluteWindowsPathsButDropsUrls() {
        val text = "C:\\work\\pi-app\\generated-images\\a.PNG plus https://example.com/b.png"
        assertEquals(listOf("C:\\work\\pi-app\\generated-images\\a.PNG"), ImagePaths.find(text))
    }

    @Test
    fun ignoresProseThatOnlyMentionsAnExtension() {
        assertTrue(ImagePaths.find("use a .png or a data:image/png;base64,AAAA").isEmpty())
        assertTrue(ImagePaths.find("no images here").isEmpty())
    }

    @Test
    fun capsTheNumberOfPicturesPerStep() {
        val text = (1..6).joinToString(" ") { "shots/s$it.png" }
        assertEquals(3, ImagePaths.find(text).size)
    }
}
