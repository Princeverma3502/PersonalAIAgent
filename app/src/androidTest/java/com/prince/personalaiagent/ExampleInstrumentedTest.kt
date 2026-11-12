package com.prince.personalaiagent

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeDown
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ExampleInstrumentedTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun useAppContext() {
        val appContext = InstrumentationRegistry.getInstrumentation().targetContext
        assertEquals("com.prince.personalaiagent", appContext.packageName)
    }

    @Test
    fun markdownTextIsDisplayed() {
        composeRule.setContent {
            MaterialTheme {
                dev.jeziellago.compose.markdowntext.MarkdownText(
                    markdown = "Hello **formatted** message",
                    modifier = Modifier.testTag("markdown_message")
                )
            }
        }

        composeRule.onNodeWithTag("markdown_message").assertIsDisplayed()
    }

    @Test
    fun chatListSupportsScrollingAndTracksNewMessages() {
        val messages = mutableStateListOf<ChatMessage>().apply {
            addAll((0 until 30).map { id ->
                ChatMessage(id, "Message $id", false)
            })
        }
        val listState = LazyListState()

        composeRule.setContent {
            MaterialTheme {
                ChatMessageList(
                    messages = messages,
                    isLoading = false,
                    listState = listState,
                    onOpenBrowser = {},
                    modifier = Modifier
                        .fillMaxSize()
                        .testTag("chat_messages")
                )
            }
        }

        composeRule.runOnIdle {
            assertEquals(29, listState.layoutInfo.visibleItemsInfo.last().index)
        }

        composeRule.onNodeWithTag("chat_messages").performTouchInput {
            repeat(6) { swipeDown() }
        }

        composeRule.runOnIdle {
            assertEquals(0, listState.firstVisibleItemIndex)
            messages.add(ChatMessage(30, "Message 30", false))
        }

        composeRule.waitForIdle()

        composeRule.runOnIdle {
            val visibleIndexes = listState.layoutInfo.visibleItemsInfo.map { it.index }
            assertTrue(
                "Expected item 30 to be visible after auto-scroll, but visible items were $visibleIndexes",
                visibleIndexes.any { it == 30 }
            )
        }
    }
}
