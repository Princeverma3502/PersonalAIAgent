package com.prince.personalaiagent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BrowserUrlPolicyTest {
    @Test
    fun addsHttpsWhenAddressHasNoScheme() {
        assertEquals(
            "https://example.com/docs?q=agent",
            BrowserUrlPolicy.normalize(" example.com/docs?q=agent ")
        )
    }

    @Test
    fun allowsHttpAndHttpsButBlocksNonWebSchemesAndCredentials() {
        assertTrue(BrowserUrlPolicy.isAllowedNavigation("https://example.com"))
        assertTrue(BrowserUrlPolicy.isAllowedNavigation("http://example.com"))
        assertFalse(BrowserUrlPolicy.isAllowedNavigation("file:///tmp/page.html"))
        assertFalse(BrowserUrlPolicy.isAllowedNavigation("javascript:alert(1)"))
        assertFalse(
            BrowserUrlPolicy.isAllowedNavigation("https://user:password@example.com")
        )
        assertNull(BrowserUrlPolicy.normalize("javascript:alert(1)"))
    }
}
