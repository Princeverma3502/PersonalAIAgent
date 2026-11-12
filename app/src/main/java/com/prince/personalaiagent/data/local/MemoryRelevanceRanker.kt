package com.prince.personalaiagent.data.local

import java.util.Locale

object MemoryRelevanceRanker {
    private val tokenPattern = Regex("[\\p{L}\\p{N}]+")
    private val ignoredQueryTerms = setOf(
        "a", "an", "and", "are", "as", "at", "be", "can", "could", "do", "does",
        "for", "from", "how", "i", "in", "is", "it", "me", "my", "of", "on",
        "or", "please", "tell", "that", "the", "this", "to", "was", "what",
        "when", "where", "which", "who", "why", "with", "would", "you", "your"
    )

    fun selectRelevant(
        query: String,
        memories: List<MemoryEntity>,
        limit: Int = 10
    ): List<MemoryEntity> {
        if (limit <= 0 || memories.isEmpty()) return emptyList()

        val queryTerms = tokens(query)
            .filterNot(ignoredQueryTerms::contains)
            .toSet()

        if (queryTerms.isEmpty()) return newestFirst(memories).take(limit)

        val ranked = memories.mapIndexed { index, memory ->
            val memoryTerms = tokens(memory.content).toSet()
            val matchedTerms = queryTerms.count(memoryTerms::contains)
            val completeMatchBonus =
                if (queryTerms.size > 1 && matchedTerms == queryTerms.size) 2 else 0
            RankedMemory(memory, matchedTerms + completeMatchBonus, index)
        }.filter { it.score > 0 }
            .sortedWith(
                compareByDescending<RankedMemory> { it.score }
                    .thenByDescending { it.memory.createdAt }
                    .thenBy { it.originalIndex }
            )
            .map { it.memory }

        return (ranked.ifEmpty { newestFirst(memories) }).take(limit)
    }

    private fun newestFirst(memories: List<MemoryEntity>): List<MemoryEntity> =
        memories.withIndex()
            .sortedWith(
                compareByDescending<IndexedValue<MemoryEntity>> { it.value.createdAt }
                    .thenBy { it.index }
            )
            .map { it.value }

    private fun tokens(text: String): List<String> =
        tokenPattern.findAll(text.lowercase(Locale.ROOT))
            .map { it.value }
            .toList()

    private data class RankedMemory(
        val memory: MemoryEntity,
        val score: Int,
        val originalIndex: Int
    )
}
