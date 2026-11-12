package com.prince.personalaiagent.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

@Dao
interface ConversationMessageDao {

    @Query("SELECT * FROM conversation_messages ORDER BY id ASC")
    suspend fun getAllMessages(): List<ConversationMessageEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertMessage(message: ConversationMessageEntity)

    @Query("DELETE FROM conversation_messages")
    suspend fun deleteAllMessages()
}
