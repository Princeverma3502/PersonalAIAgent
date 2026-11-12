import java.net.URI

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.ksp)
}

fun validatedApiBaseUrl(
    propertyName: String,
    defaultValue: String,
    requireHttps: Boolean
): String {
    val value = providers.gradleProperty(propertyName)
        .orElse(defaultValue)
        .get()
        .trim()
        .trimEnd('/')
    val uri = try {
        URI(value)
    } catch (error: Exception) {
        throw GradleException("$propertyName must be a valid HTTP(S) URL.", error)
    }

    val scheme = uri.scheme?.lowercase()
    require(
        scheme in setOf("http", "https") &&
            uri.host != null &&
            uri.userInfo == null &&
            uri.query == null &&
            uri.fragment == null
    ) {
        "$propertyName must be an HTTP(S) origin without credentials, query, or fragment."
    }
    require(!requireHttps || scheme == "https") {
        "$propertyName must use HTTPS for release builds."
    }

    return value
}

val debugApiBaseUrl = validatedApiBaseUrl(
    propertyName = "PERSONAL_AI_DEBUG_API_BASE_URL",
    defaultValue = "http://10.0.2.2:3000",
    requireHttps = false
)
val releaseApiBaseUrl = validatedApiBaseUrl(
    propertyName = "PERSONAL_AI_RELEASE_API_BASE_URL",
    defaultValue = "https://api.example.invalid",
    requireHttps = true
)

android {
    namespace = "com.prince.personalaiagent"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.prince.personalaiagent"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        debug {
            buildConfigField("String", "API_BASE_URL", "\"$debugApiBaseUrl\"")
            manifestPlaceholders["usesCleartextTraffic"] = "true"
        }
        release {
            isMinifyEnabled = false
            buildConfigField("String", "API_BASE_URL", "\"$releaseApiBaseUrl\"")
            manifestPlaceholders["usesCleartextTraffic"] = "false"
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    kotlinOptions {
        jvmTarget = "11"
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)
    implementation(libs.compose.markdown)
    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.ui.test.junit4)
    debugImplementation(libs.androidx.ui.tooling)
    debugImplementation(libs.androidx.ui.test.manifest)
    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    ksp(libs.androidx.room.compiler)
    implementation(libs.androidx.work.runtime.ktx)
}