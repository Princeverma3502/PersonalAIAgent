package com.prince.personalaiagent.data.local

import kotlinx.coroutines.flow.Flow

class MemoryRepository(
    private val memoryDao: MemoryDao
) {

    fun getAllMemories(): Flow<List<MemoryEntity>> {
        return memoryDao.getAllMemories()
    }

    suspend fun saveMemory(
        content: String,
        category: String = "general"
    ): Long {
        val cleanedContent = content.trim()

        require(cleanedContent.isNotBlank()) {
            "Memory cannot be empty."
        }

        val memory = MemoryEntity(
            content = cleanedContent,
            category = category.trim().ifBlank { "general" }
        )

        return memoryDao.insertMemory(memory)
    }

    suspend fun searchMemories(keyword: String): List<MemoryEntity> {
        return memoryDao.searchMemories(keyword.trim())
    }

    suspend fun deleteMemory(memory: MemoryEntity) {
        memoryDao.deleteMemory(memory)
    }

    suspend fun deleteAllMemories() {
        memoryDao.deleteAllMemories()
    }
}
