package com.prince.personalaiagent

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.prince.personalaiagent.data.remote.ChatApiClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.LinkedHashSet
import java.util.concurrent.TimeUnit

private const val REMINDER_CHANNEL_ID = "scheduled_reminders"
private const val REMINDER_CHANNEL_NAME = "Scheduled reminders"
private const val REMINDER_WORK_NAME = "scheduled-reminder-delivery"
private const val REMINDER_STARTUP_WORK_NAME = "scheduled-reminder-startup-check"
private const val DELIVERY_PREFERENCES = "reminder_delivery"
private const val DELIVERED_IDS_KEY = "delivered_reminder_ids"
private const val MAX_DELIVERED_IDS = 500

object ReminderDeliveryStore {
    @Synchronized
    fun deliverOnce(context: Context, reminderId: String, deliver: () -> Unit): Boolean {
        val preferences = context.getSharedPreferences(
            DELIVERY_PREFERENCES,
            Context.MODE_PRIVATE
        )
        val deliveredIds = LinkedHashSet(
            preferences.getStringSet(DELIVERED_IDS_KEY, emptySet()).orEmpty()
        )
        if (!deliveredIds.add(reminderId)) return false

        deliver()
        while (deliveredIds.size > MAX_DELIVERED_IDS) {
            deliveredIds.remove(deliveredIds.first())
        }

        preferences.edit()
            .putStringSet(DELIVERED_IDS_KEY, deliveredIds)
            .apply()
        return true
    }
}

object ReminderWorkScheduler {
    fun enqueue(context: Context) {
        val workManager = WorkManager.getInstance(context.applicationContext)
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        val startupRequest = OneTimeWorkRequestBuilder<ReminderDeliveryWorker>()
            .setConstraints(constraints)
            .setBackoffCriteria(
                BackoffPolicy.EXPONENTIAL,
                30,
                TimeUnit.SECONDS
            )
            .build()
        workManager.enqueueUniqueWork(
            REMINDER_STARTUP_WORK_NAME,
            ExistingWorkPolicy.KEEP,
            startupRequest
        )

        val periodicRequest =
            PeriodicWorkRequestBuilder<ReminderDeliveryWorker>(
                15,
                TimeUnit.MINUTES
            )
                .setConstraints(constraints)
                .setBackoffCriteria(
                    BackoffPolicy.EXPONENTIAL,
                    15,
                    TimeUnit.MINUTES
                )
                .build()
        workManager.enqueueUniquePeriodicWork(
            REMINDER_WORK_NAME,
            ExistingPeriodicWorkPolicy.KEEP,
            periodicRequest
        )
    }
}

class ReminderDeliveryWorker(
    appContext: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        try {
            createNotificationChannel(applicationContext)
            val apiClient = ChatApiClient()
            val reminders = apiClient.getPendingReminders()
            val notifications = NotificationManagerCompat.from(applicationContext)

            for (reminder in reminders) {
                if (
                    !notifications.areNotificationsEnabled() ||
                    (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                        applicationContext.checkSelfPermission(
                            android.Manifest.permission.POST_NOTIFICATIONS
                        ) != PackageManager.PERMISSION_GRANTED)
                ) {
                    Log.i(TAG, "Notification permission is unavailable; reminder remains pending.")
                    return@withContext Result.success()
                }

                ReminderDeliveryStore.deliverOnce(
                    applicationContext,
                    reminder.taskId
                ) {
                        notifications.notify(
                            reminder.taskId,
                            0,
                            buildNotification(
                                applicationContext,
                                reminder.title,
                                reminder.message,
                                reminder.taskId
                            )
                        )
                }

                apiClient.acknowledgeReminder(reminder.taskId)
            }

            Result.success()
        } catch (error: Exception) {
            Log.w(TAG, "Background reminder delivery failed; WorkManager will retry.", error)
            Result.retry()
        }
    }

    private fun createNotificationChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = context.getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(
                NotificationChannel(
                    REMINDER_CHANNEL_ID,
                    REMINDER_CHANNEL_NAME,
                    NotificationManager.IMPORTANCE_DEFAULT
                )
            )
        }
    }

    private fun buildNotification(
        context: Context,
        title: String,
        message: String,
        reminderId: String
    ) = NotificationCompat.Builder(context, REMINDER_CHANNEL_ID)
        .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
        .setContentTitle(title)
        .setContentText(message)
        .setStyle(NotificationCompat.BigTextStyle().bigText(message))
        .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
        .setAutoCancel(true)
        .setContentIntent(openAppPendingIntent(context, reminderId))
        .build()

    private fun openAppPendingIntent(
        context: Context,
        reminderId: String
    ): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            data = Uri.parse("personalaiagent://reminder/$reminderId")
        }
        return PendingIntent.getActivity(
            context,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private companion object {
        const val TAG = "ReminderDelivery"
    }
}
