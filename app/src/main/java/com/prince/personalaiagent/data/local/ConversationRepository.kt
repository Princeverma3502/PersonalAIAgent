package com.prince.personalaiagent.data.local

class ConversationRepository(
    private val conversationMessageDao: ConversationMessageDao
) {

    suspend fun getAllMessages(): List<ConversationMessageEntity> {
        return conversationMessageDao.getAllMessages()
    }

    suspend fun saveMessage(
        id: Int,
        text: String,
        isUser: Boolean
    ) {
        require(id >= 0) {
            "Conversation message id must not be negative."
        }
        require(text.isNotBlank()) {
            "Conversation message cannot be empty."
        }

        conversationMessageDao.insertMessage(
            ConversationMessageEntity(
                id = id,
                text = text,
                isUser = isUser
            )
        )
    }

    suspend fun clearHistory() {
        conversationMessageDao.deleteAllMessages()
    }
}
