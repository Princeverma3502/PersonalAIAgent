package com.prince.personalaiagent

import android.content.Context
import androidx.room.Room
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.prince.personalaiagent.data.local.ConversationRepository
import com.prince.personalaiagent.data.local.MemoryDatabase
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ConversationHistoryDatabaseTest {
    private val databaseName = "conversation-history-test.db"
    private val context =
        InstrumentationRegistry.getInstrumentation().targetContext
    private lateinit var database: MemoryDatabase

    @Before
    fun createDatabase() {
        context.deleteDatabase(databaseName)
        database = Room.databaseBuilder(
            context,
            MemoryDatabase::class.java,
            databaseName
        ).build()
    }

    @After
    fun closeDatabase() {
        if (::database.isInitialized) {
            database.close()
        }
        context.deleteDatabase(databaseName)
    }

    @Test
    fun conversationSurvivesDatabaseReopenAndCanBeCleared() = runBlocking {
        val repository = ConversationRepository(database.conversationMessageDao())
        repository.saveMessage(0, "Welcome", isUser = false)
        repository.saveMessage(1, "Remember my meeting", isUser = true)
        repository.saveMessage(2, "I will remember that.", isUser = false)
        database.close()

        database = Room.databaseBuilder(
            context,
            MemoryDatabase::class.java,
            databaseName
        ).build()
        val restoredRepository =
            ConversationRepository(database.conversationMessageDao())
        val restoredMessages = restoredRepository.getAllMessages()

        assertEquals(
            listOf(
                "Welcome",
                "Remember my meeting",
                "I will remember that."
            ),
            restoredMessages.map { it.text }
        )
        assertEquals(
            listOf(false, true, false),
            restoredMessages.map { it.isUser }
        )

        restoredRepository.clearHistory()
        assertTrue(restoredRepository.getAllMessages().isEmpty())
    }

    @Test
    fun migrationPreservesExistingMemoriesAndCreatesConversationTable() = runBlocking {
        val legacyDatabase = context.openOrCreateDatabase(
            databaseName,
            Context.MODE_PRIVATE,
            null
        )
        legacyDatabase.execSQL(
            """
            CREATE TABLE `memories` (
                `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                `content` TEXT NOT NULL,
                `category` TEXT NOT NULL,
                `createdAt` INTEGER NOT NULL
            )
            """.trimIndent()
        )
        legacyDatabase.execSQL(
            "INSERT INTO `memories` (`content`, `category`, `createdAt`) VALUES (?, ?, ?)",
            arrayOf("Keep existing memory", "general", 1)
        )
        legacyDatabase.version = 1
        legacyDatabase.close()

        database = Room.databaseBuilder(
            context,
            MemoryDatabase::class.java,
            databaseName
        )
            .addMigrations(MemoryDatabase.MIGRATION_1_2)
            .build()

        val messages = ConversationRepository(database.conversationMessageDao())
            .getAllMessages()
        assertTrue(messages.isEmpty())
        val memories = database.memoryDao().getAllMemories().first()
        assertEquals("Keep existing memory", memories.single().content)
    }
}
