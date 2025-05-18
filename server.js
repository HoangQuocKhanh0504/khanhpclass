const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const PORT = 3000;

app.use(express.static('public'));

const rooms = {}; // Lưu phòng: { roomName: { code, maxStudents, students: [{id, name, screen}], timeoutId } }

// API tạo phòng (post JSON)
app.use(express.json());
app.post('/create-room', (req, res) => {
  const { roomName, roomCode, maxStudents } = req.body;
  if (!roomName || !roomCode || !maxStudents) return res.status(400).json({ error: 'Thiếu thông tin' });

  if (rooms[roomName]) return res.status(400).json({ error: 'Tên phòng đã tồn tại' });

  rooms[roomName] = {
    code: roomCode,
    maxStudents: parseInt(maxStudents),
    students: [],
    timeoutId: null
  };
  res.json({ success: true });
});

// Socket.io kết nối
io.on('connection', socket => {
  console.log('Người dùng kết nối:', socket.id);

  // Giáo viên đăng nhập quản lý phòng
  socket.on('teacher-join', ({ roomName, roomCode }) => {
    if (!rooms[roomName] || rooms[roomName].code !== roomCode) {
      socket.emit('error-msg', 'Phòng không tồn tại hoặc mã sai');
      return;
    }
    socket.join(roomName);
    socket.isTeacher = true;
    socket.roomName = roomName;

    // Gửi danh sách học sinh hiện tại cho giáo viên
    socket.emit('students-list', rooms[roomName].students.map(s => ({ id: s.id, name: s.name })));
  });

  // Học sinh tham gia phòng
  socket.on('student-join', ({ roomName, roomCode, studentName }) => {
    if (!rooms[roomName] || rooms[roomName].code !== roomCode) {
      socket.emit('error-msg', 'Phòng không tồn tại hoặc mã sai');
      return;
    }
    if (rooms[roomName].students.length >= rooms[roomName].maxStudents) {
      socket.emit('error-msg', 'Phòng đã đầy học sinh');
      return;
    }

    socket.join(roomName);
    socket.isTeacher = false;
    socket.roomName = roomName;
    socket.studentName = studentName;

    // Hủy timeout xóa phòng nếu có
    if (rooms[roomName].timeoutId) {
      clearTimeout(rooms[roomName].timeoutId);
      rooms[roomName].timeoutId = null;
    }

    // Thêm học sinh vào phòng
    rooms[roomName].students.push({ id: socket.id, name: studentName, screen: null });

    // Thông báo cập nhật danh sách cho giáo viên
    io.to(roomName).emit('students-list', rooms[roomName].students.map(s => ({ id: s.id, name: s.name })));
  });

  // Nhận ảnh màn hình học sinh
  socket.on('screen-data', data => {
    if (!socket.isTeacher && socket.roomName) {
      const room = rooms[socket.roomName];
      if (!room) return;

      const student = room.students.find(s => s.id === socket.id);
      if (student) {
        student.screen = data.image;
        io.to(socket.roomName).emit('screen-update', { id: socket.id, image: data.image, name: student.name });
      }
    }
  });

  // Xử lý ngắt kết nối
  socket.on('disconnect', () => {
    if (socket.roomName && !socket.isTeacher) {
      const room = rooms[socket.roomName];
      if (!room) return;

      // Xóa học sinh khỏi phòng
      room.students = room.students.filter(s => s.id !== socket.id);

      // Cập nhật lại danh sách học sinh cho giáo viên
      io.to(socket.roomName).emit('students-list', room.students.map(s => ({ id: s.id, name: s.name })));

      // Nếu phòng trống, thiết lập timeout xóa phòng sau 5 phút (300000 ms)
      if (room.students.length === 0) {
        room.timeoutId = setTimeout(() => {
          console.log(`Phòng ${socket.roomName} trống, xóa phòng tự động.`);
          delete rooms[socket.roomName];
          io.to(socket.roomName).emit('room-closed', 'Phòng đã bị xóa do không còn học sinh.');
        }, 100); // 5 phút
      }
    }
  });
});

http.listen(PORT, () => {
  console.log(`Server chạy ở http://localhost:${PORT}`);
});
