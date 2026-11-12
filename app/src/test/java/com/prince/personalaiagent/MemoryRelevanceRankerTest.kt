package com.prince.personalaiagent

import com.prince.personalaiagent.data.local.MemoryEntity
import com.prince.personalaiagent.data.local.MemoryRelevanceRanker
import org.junit.Assert.assertEquals
import org.junit.Test

class MemoryRelevanceRankerTest {
    @Test
    fun matchingMemoriesRankAheadOfNewerUnrelatedMemories() {
        val coffeePreference = MemoryEntity(
            id = 1,
            content = "I prefer oat milk in coffee.",
            createdAt = 100
        )
        val recentTravelPlan = MemoryEntity(
            id = 2,
            content = "I am planning a trip to Kyoto.",
            createdAt = 200
        )

        val selected = MemoryRelevanceRanker.selectRelevant(
            "Which milk do I prefer?",
            listOf(recentTravelPlan, coffeePreference)
        )

        assertEquals(listOf(coffeePreference), selected)
    }

    @Test
    fun usesRecentMemoriesWhenNoTermsMatchAndRespectsLimit() {
        val newest = MemoryEntity(id = 1, content = "Newest note", createdAt = 300)
        val older = MemoryEntity(id = 2, content = "Older note", createdAt = 200)
        val oldest = MemoryEntity(id = 3, content = "Oldest note", createdAt = 100)

        val selected = MemoryRelevanceRanker.selectRelevant(
            "Find information about astronomy",
            listOf(oldest, newest, older),
            limit = 2
        )

        assertEquals(listOf(newest, older), selected)
    }

    @Test
    fun returnsNoMemoriesForNonPositiveLimit() {
        val memories = listOf(MemoryEntity(id = 1, content = "A preference"))

        assertEquals(emptyList<MemoryEntity>(), MemoryRelevanceRanker.selectRelevant("preference", memories, 0))
    }
}
