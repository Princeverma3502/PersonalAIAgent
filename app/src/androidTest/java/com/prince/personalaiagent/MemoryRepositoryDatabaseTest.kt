package com.prince.personalaiagent

import androidx.room.Room
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.prince.personalaiagent.data.local.MemoryDatabase
import com.prince.personalaiagent.data.local.MemoryEntity
import com.prince.personalaiagent.data.local.MemoryRepository
import com.prince.personalaiagent.data.local.MemorySaveCommandHandler
import com.prince.personalaiagent.data.local.MemorySaveCommandResult
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MemoryRepositoryDatabaseTest {
    private val databaseName = "memory-repository-test.db"
    private val context =
        InstrumentationRegistry.getInstrumentation().targetContext
    private lateinit var database: MemoryDatabase
    private lateinit var repository: MemoryRepository

    @Before
    fun createDatabase() {
        context.deleteDatabase(databaseName)
        database = Room.databaseBuilder(
            context,
            MemoryDatabase::class.java,
            databaseName
        ).build()
        repository = MemoryRepository(database.memoryDao())
    }

    @After
    fun closeDatabase() {
        if (::database.isInitialized) {
            database.close()
        }
        context.deleteDatabase(databaseName)
    }

    @Test
    fun memoryCanBeSavedListedSearchedUpdatedAndDeleted() = runBlocking {
        val firstId = repository.saveMemory(
            "  I prefer oat milk  ",
            "  preference  "
        )
        repository.saveMemory("I live in Toronto")

        val initialMemories = repository.getAllMemories().first()
        val firstMemory = initialMemories.first { it.id == firstId.toInt() }
        assertEquals("I prefer oat milk", firstMemory.content)
        assertEquals("preference", firstMemory.category)
        assertEquals(2, initialMemories.size)
        assertEquals(
            listOf(firstMemory),
            repository.searchMemories("oat milk")
        )

        val updatedRows = repository.updateMemory(
            firstMemory.copy(
                content = "  I prefer almond milk  ",
                category = "   "
            )
        )
        assertEquals(1, updatedRows)
        val updatedMemory =
            repository.getAllMemories().first().first { it.id == firstMemory.id }
        assertEquals("I prefer almond milk", updatedMemory.content)
        assertEquals("general", updatedMemory.category)
        assertTrue(repository.searchMemories("oat milk").isEmpty())

        repository.deleteMemory(updatedMemory)
        assertEquals(1, repository.getAllMemories().first().size)

        repository.deleteAllMemories()
        assertTrue(repository.getAllMemories().first().isEmpty())
    }

    @Test
    fun naturalLanguageSaveIsConfirmedOnlyAfterRoomPersistsIt() = runBlocking {
        val result = MemorySaveCommandHandler.handle(
            "Remember that I am a final year B.Tech student.",
            repository
        )

        assertTrue(result is MemorySaveCommandResult.Saved)
        val saved = result as MemorySaveCommandResult.Saved
        assertTrue(saved.memoryId > 0)
        assertEquals(
            "I am a final year B.Tech student",
            saved.content
        )

        database.close()
        database = Room.databaseBuilder(
            context,
            MemoryDatabase::class.java,
            databaseName
        ).build()
        repository = MemoryRepository(database.memoryDao())

        assertEquals(
            saved.content,
            repository.getAllMemories().first().single().content
        )
    }

    @Test
    fun unsupportedMemorySaveIntentDoesNotReportOrStoreSuccess() = runBlocking {
        val result = MemorySaveCommandHandler.handle(
            "Could you store that I like tea?",
            repository
        )

        assertTrue(result is MemorySaveCommandResult.UnsupportedIntent)
        assertTrue(repository.getAllMemories().first().isEmpty())
    }

    @Test
    fun blankMemoryContentIsRejectedOnCreateAndUpdate() = runBlocking {
        try {
            repository.saveMemory("   ")
            throw AssertionError("Expected blank memory save to fail.")
        } catch (_: IllegalArgumentException) {
        }

        val id = repository.saveMemory("A valid memory")
        val memory = repository.getAllMemories().first()
            .single { it.id == id.toInt() }

        try {
            repository.updateMemory(memory.copy(content = "  "))
            throw AssertionError("Expected blank memory update to fail.")
        } catch (_: IllegalArgumentException) {
        }

        assertEquals(
            "A valid memory",
            repository.getAllMemories().first().single().content
        )
    }
}
