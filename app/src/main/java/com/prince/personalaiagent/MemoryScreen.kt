
package com.prince.personalaiagent

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.prince.personalaiagent.data.local.MemoryEntity
import com.prince.personalaiagent.data.local.MemoryRepository
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MemoryScreen(
    memoryRepository: MemoryRepository,
    onBack: () -> Unit
) {
    val memories by memoryRepository.getAllMemories()
        .collectAsState(initial = emptyList())

    val coroutineScope = rememberCoroutineScope()

    var selectedMemory by remember {
        mutableStateOf<MemoryEntity?>(null)
    }

    var showDeleteAllDialog by remember {
        mutableStateOf(false)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("My Memories") },
                navigationIcon = {
                    TextButton(onClick = onBack) {
                        Text("Back")
                    }
                }
            )
        }
    ) { padding ->

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp)
        ) {

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "${memories.size} saved memories",
                    style = MaterialTheme.typography.titleMedium
                )

                TextButton(
                    onClick = { showDeleteAllDialog = true },
                    enabled = memories.isNotEmpty()
                ) {
                    Text("Delete All")
                }
            }

            Spacer(modifier = Modifier.height(12.dp))

            if (memories.isEmpty()) {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    Text("No saved memories yet.")
                }
            } else {
                LazyColumn(
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    items(
                        items = memories,
                        key = { it.id }
                    ) { memory ->

                        Card(
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(16.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = memory.content,
                                    modifier = Modifier.weight(1f),
                                    style = MaterialTheme.typography.bodyLarge
                                )

                                TextButton(
                                    onClick = {
                                        selectedMemory = memory
                                    }
                                ) {
                                    Text("Delete")
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Confirm deletion of one memory
    selectedMemory?.let { memory ->
        AlertDialog(
            onDismissRequest = {
                selectedMemory = null
            },
            title = {
                Text("Delete memory?")
            },
            text = {
                Text("Are you sure you want to delete this saved memory?")
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        coroutineScope.launch {
                            memoryRepository.deleteMemory(memory)
                        }
                        selectedMemory = null
                    }
                ) {
                    Text("Delete")
                }
            },
            dismissButton = {
                TextButton(
                    onClick = {
                        selectedMemory = null
                    }
                ) {
                    Text("Cancel")
                }
            }
        )
    }

    // Confirm deletion of all memories
    if (showDeleteAllDialog) {
        AlertDialog(
            onDismissRequest = {
                showDeleteAllDialog = false
            },
            title = {
                Text("Delete all memories?")
            },
            text = {
                Text("This will permanently delete all saved memories.")
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        coroutineScope.launch {
                            memoryRepository.deleteAllMemories()
                        }
                        showDeleteAllDialog = false
                    }
                ) {
                    Text("Delete All")
                }
            },
            dismissButton = {
                TextButton(
                    onClick = {
                        showDeleteAllDialog = false
                    }
                ) {
                    Text("Cancel")
                }
            }
        )
    }
}
