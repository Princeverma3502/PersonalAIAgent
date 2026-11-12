package com.prince.personalaiagent.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "memories")
data class MemoryEntity(
    @PrimaryKey(autoGenerate = true)
    val id: Int = 0,

    val content: String,

    val category: String = "general",

    val createdAt: Long = System.currentTimeMillis()
)
