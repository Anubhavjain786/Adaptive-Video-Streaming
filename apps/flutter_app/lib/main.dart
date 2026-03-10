import 'package:flutter/material.dart';
import 'pages/upload_page.dart';
import 'pages/player_page.dart';

void main() {
  runApp(const HudleStreamingApp());
}

class HudleStreamingApp extends StatelessWidget {
  const HudleStreamingApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Hudle Streaming',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF0066FF),
          brightness: Brightness.dark,
        ),
        useMaterial3: true,
      ),
      home: const HomePage(),
    );
  }
}

class HomePage extends StatefulWidget {
  const HomePage({super.key});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  int _selectedIndex = 0;

  final List<Widget> _pages = const [
    UploadPage(),
    PlayerPage(),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: _pages[_selectedIndex],
      bottomNavigationBar: NavigationBar(
        selectedIndex: _selectedIndex,
        onDestinationSelected: (index) =>
            setState(() => _selectedIndex = index),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.upload_rounded),
            label: 'Upload',
          ),
          NavigationDestination(
            icon: Icon(Icons.play_circle_rounded),
            label: 'Play',
          ),
        ],
      ),
    );
  }
}
