import 'package:flutter/material.dart';

void main() => runApp(const HabitsApp());

class HabitsApp extends StatelessWidget {
  const HabitsApp({super.key});

  @override
  Widget build(BuildContext context) => const MaterialApp(home: Scaffold(body: Center(child: Text('Today'))));
}
