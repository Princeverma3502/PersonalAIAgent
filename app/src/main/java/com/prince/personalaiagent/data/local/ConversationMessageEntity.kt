package com.prince.personalaiagent.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "conversation_messages")
data class ConversationMessageEntity(
    @PrimaryKey
    val id: Int,
    val text: String,
    val isUser: Boolean,
    val createdAt: Long = System.currentTimeMillis()
)
